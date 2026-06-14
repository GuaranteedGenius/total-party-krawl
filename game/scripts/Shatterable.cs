using Godot;
using System.Collections.Generic;

// Reusable destructible component. Attach to a prop instance and assign its
// matching *_fragments.glb. Call Shatter(impactPoint) to replace the prop with
// physics-driven fragments that burst away from the impact point.
public partial class Shatterable : Node3D
{
    [Export] public PackedScene Fragments;
    [Export] public float Force = 4.0f;
    [Export] public float UpwardBoost = 2.0f;

    // Hidden durability. Explosions chip this down by proximity; the prop only
    // breaks when it reaches zero. Set per-type in the scene (barrels weak,
    // crates medium, pillars tough).
    [Export] public float MaxHealth = 100f;

    private float _health;
    private bool _spent;

    public override void _Ready()
    {
        AddToGroup("shatterable");
        _health = MaxHealth;
    }

    // Apply a blast centered at `origin`. Damage falls off sharply with distance
    // (squared falloff): point-blank hits land near-full damage, mid-range much
    // less, edge ~0. Props outside `radius` are untouched. When health is
    // depleted the prop shatters away from the blast origin.
    public void ApplyExplosion(Vector3 origin, float damage, float radius)
    {
        if (_spent) return;

        float dist = GlobalPosition.DistanceTo(origin);
        if (dist >= radius) return; // out of range -> untouched

        float factor = Mathf.Clamp(1f - dist / radius, 0f, 1f);
        factor *= factor; // square it: damage drops off sharply with distance
        float dealt = damage * factor;
        if (dealt <= 0f) return;

        _health -= dealt;
        GD.Print($"Shatterable '{Name}': took {dealt:0.0} dmg at {dist:0.00}m -> {_health:0.0}/{MaxHealth} HP");

        if (_health <= 0f)
        {
            Shatter(origin); // fragments burst away from the blast
        }
        // else: survives intact for now.
        // TODO: damaged visual state (cracks) -- needs art (future mesh/material job)
    }

    public void Shatter(Vector3 impactPoint)
    {
        if (_spent || Fragments == null) return;
        _spent = true;

        // Capture world transform before we free this node's subtree.
        Transform3D xform = GlobalTransform;

        // Fragments spawn under the scene tree root so they outlive this prop.
        Node parent = GetParent();

        var fragRoot = Fragments.Instantiate<Node3D>();
        parent.AddChild(fragRoot);
        fragRoot.GlobalTransform = xform;

        // Collect mesh instances first (we reparent them, so don't mutate while iterating).
        var meshes = new List<MeshInstance3D>();
        CollectMeshes(fragRoot, meshes);

        foreach (var mesh in meshes)
        {
            if (mesh.Mesh == null) continue;
            Transform3D meshXform = mesh.GlobalTransform;

            var body = new RigidBody3D();
            parent.AddChild(body);
            body.GlobalTransform = meshXform;

            mesh.GetParent().RemoveChild(mesh);
            body.AddChild(mesh);
            mesh.Transform = Transform3D.Identity;

            var col = new CollisionShape3D();
            col.Shape = mesh.Mesh.CreateConvexShape();
            body.AddChild(col);

            Vector3 dir = body.GlobalPosition - impactPoint;
            if (dir.Length() < 0.01f)
                dir = new Vector3(GD.Randf() - 0.5f, 0.5f, GD.Randf() - 0.5f);
            body.ApplyImpulse(dir.Normalized() * Force + Vector3.Up * UpwardBoost);
        }

        // The now-empty fragments scene root and the original prop can be discarded.
        fragRoot.QueueFree();
        QueueFree();
    }

    private static void CollectMeshes(Node node, List<MeshInstance3D> acc)
    {
        if (node is MeshInstance3D mi) acc.Add(mi);
        foreach (Node child in node.GetChildren())
            CollectMeshes(child, acc);
    }
}
