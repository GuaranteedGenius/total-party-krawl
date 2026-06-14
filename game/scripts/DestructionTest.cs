using Godot;
using System.Collections.Generic;

// Art-test destruction proof: on the "destruct" trigger (Space), replace every
// destructible prop in the scene (barrels, crates, pillars) with its pre-fractured
// *_fragments.glb and scatter the pieces with Jolt physics.
public partial class DestructionTest : Node3D
{
    [Export] public PackedScene BarrelFragments;
    [Export] public PackedScene CrateFragments;
    [Export] public PackedScene PillarFragments;
    [Export] public float ExplosionForce = 4.0f;
    [Export] public float UpwardBoost = 2.0f;

    private bool _spent;

    public override void _UnhandledInput(InputEvent @event)
    {
        if (_spent) return;
        if (@event is InputEventKey k && k.Pressed && k.PhysicalKeycode == Key.Space)
            ShatterAll();
    }

    private void ShatterAll()
    {
        _spent = true;

        // Capture every destructible (its world transform + fragments) BEFORE freeing
        // anything, so freeing a parent doesn't invalidate a nested target's transform.
        var targets = new List<(Transform3D xform, PackedScene frags)>();
        var nodes = new List<Node3D>();
        CollectTargets(this, targets, nodes);

        GD.Print($"DestructionTest: shattering {targets.Count} props.");
        foreach (var (xform, frags) in targets)
            ShatterOne(xform, frags);
        foreach (var node in nodes)
            node.QueueFree();
    }

    private void CollectTargets(Node node, List<(Transform3D, PackedScene)> acc, List<Node3D> nodes)
    {
        foreach (Node child in node.GetChildren())
        {
            // Match on the source asset (only scene-instance roots have a SceneFilePath),
            // so internal mesh children (e.g. "crate_wood_1_complete") are never matched.
            PackedScene frags = child is Node3D n3d ? FragmentsFor(n3d.SceneFilePath) : null;
            if (frags != null && child is Node3D target)
            {
                acc.Add((target.GlobalTransform, frags));
                nodes.Add(target);
            }
            // Recurse regardless, to catch nested instances (e.g. stacked pillars).
            CollectTargets(child, acc, nodes);
        }
    }

    private PackedScene FragmentsFor(string sceneFilePath)
    {
        if (string.IsNullOrEmpty(sceneFilePath)) return null;
        if (sceneFilePath.EndsWith("barrel_wood_1.glb")) return BarrelFragments;
        if (sceneFilePath.EndsWith("crate_wood_1.glb")) return CrateFragments;
        if (sceneFilePath.EndsWith("pillar_stone_1.glb")) return PillarFragments;
        return null;
    }

    private void ShatterOne(Transform3D xform, PackedScene fragmentsScene)
    {
        if (fragmentsScene == null) return;

        Vector3 origin = xform.Origin;
        var fragRoot = fragmentsScene.Instantiate<Node3D>();
        AddChild(fragRoot);
        fragRoot.GlobalTransform = xform;

        // Collect mesh instances first (we reparent them, so don't mutate while iterating).
        var meshes = new List<MeshInstance3D>();
        CollectMeshes(fragRoot, meshes);

        foreach (var mesh in meshes)
        {
            if (mesh.Mesh == null) continue;
            Transform3D meshXform = mesh.GlobalTransform;

            var body = new RigidBody3D();
            AddChild(body);
            body.GlobalTransform = meshXform;

            mesh.GetParent().RemoveChild(mesh);
            body.AddChild(mesh);
            mesh.Transform = Transform3D.Identity;

            var col = new CollisionShape3D();
            col.Shape = mesh.Mesh.CreateConvexShape();
            body.AddChild(col);

            Vector3 dir = body.GlobalPosition - origin;
            if (dir.Length() < 0.01f)
                dir = new Vector3(GD.Randf() - 0.5f, 0.5f, GD.Randf() - 0.5f);
            body.ApplyImpulse(dir.Normalized() * ExplosionForce + Vector3.Up * UpwardBoost);
        }

        // The now-empty fragments scene root can be discarded.
        fragRoot.QueueFree();
    }

    private static void CollectMeshes(Node node, List<MeshInstance3D> acc)
    {
        if (node is MeshInstance3D mi) acc.Add(mi);
        foreach (Node child in node.GetChildren())
            CollectMeshes(child, acc);
    }
}
