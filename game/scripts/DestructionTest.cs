using Godot;
using System.Collections.Generic;

public partial class DestructionTest : Node3D
{
    [Export] public NodePath TargetPath;
    [Export] public PackedScene FragmentsScene;
    [Export] public float ExplosionForce = 4.0f;
    [Export] public float UpwardBoost = 2.0f;

    private bool _spent;

    public override void _Ready()
    {
        if (OS.GetEnvironment("TPK_AUTODESTRUCT") != "")
        {
            var t = GetTree().CreateTimer(0.25);
            t.Timeout += Shatter;
        }
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventKey k && k.Pressed && k.PhysicalKeycode == Key.Space)
            Shatter();
    }

    private void Shatter()
    {
        if (_spent) return;

        var target = GetNodeOrNull<Node3D>(TargetPath);
        if (target == null || FragmentsScene == null)
        {
            GD.PushWarning("DestructionTest: TargetPath or FragmentsScene not set.");
            return;
        }
        _spent = true;

        Transform3D xform = target.GlobalTransform;
        Vector3 origin = xform.Origin;
        target.QueueFree();

        var fragRoot = FragmentsScene.Instantiate<Node3D>();
        AddChild(fragRoot);
        fragRoot.GlobalTransform = xform;

        var meshes = new List<MeshInstance3D>();
        CollectMeshes(fragRoot, meshes);
        GD.Print($"DestructionTest: shattering into {meshes.Count} fragment meshes.");

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
