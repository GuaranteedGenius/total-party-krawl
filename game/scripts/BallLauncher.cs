using Godot;
using System.Collections.Generic;

// Click-to-fire wrecking ball. On left-click, spawns a sphere RigidBody at the
// player, gives it a ballistic velocity so it arcs onto the boss in FlightTime
// seconds, and on impact (proximity to boss or timeout) shatters every
// Shatterable within BlastRadius. Boss does not react yet -- scenery only.
public partial class BallLauncher : Node3D
{
    [Export] public NodePath PlayerPath;
    [Export] public NodePath BossPath;
    [Export] public float FlightTime = 0.8f;
    [Export] public float BallRadius = 0.35f;

    // Explosion model: on impact every Shatterable takes proximity-scaled
    // damage (squared falloff inside ExplosionRadius). It does NOT break
    // everything in range -- only props whose hidden health is depleted.
    [Export] public float ExplosionDamage = 480f;
    [Export] public float ExplosionRadius = 6.0f;

    private readonly List<Ball> _balls = new();

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventMouseButton mb &&
            mb.ButtonIndex == MouseButton.Left && mb.Pressed)
            Fire();
    }

    private void Fire()
    {
        var player = GetNodeOrNull<Node3D>(PlayerPath);
        var boss = GetNodeOrNull<Node3D>(BossPath);
        if (player == null || boss == null)
        {
            GD.PrintErr("BallLauncher: PlayerPath/BossPath not wired.");
            return;
        }

        Vector3 start = player.GlobalPosition + Vector3.Up * 1.0f;
        Vector3 target = boss.GlobalPosition + Vector3.Up * 1.0f; // aim at boss center

        // Ballistic solve: position(t) = start + v*t + 0.5*g*t^2.
        // Require position(FlightTime) == target  =>  v = (target-start)/T - 0.5*g*T.
        float g = (float)ProjectSettings.GetSetting(
            "physics/3d/default_gravity", 9.8f);
        Vector3 gravity = Vector3.Down * g;
        Vector3 v = (target - start) / FlightTime - 0.5f * gravity * FlightTime;

        var body = new RigidBody3D();
        var mesh = new MeshInstance3D
        {
            Mesh = new SphereMesh { Radius = BallRadius, Height = BallRadius * 2f }
        };
        body.AddChild(mesh);
        var col = new CollisionShape3D { Shape = new SphereShape3D { Radius = BallRadius } };
        body.AddChild(col);

        AddChild(body);
        body.GlobalPosition = start;
        body.LinearVelocity = v;

        _balls.Add(new Ball { Body = body, Boss = boss, Age = 0f });
        GD.Print("BallLauncher: fired wrecking ball.");
    }

    public override void _PhysicsProcess(double delta)
    {
        if (_balls.Count == 0) return;

        float dt = (float)delta;
        for (int i = _balls.Count - 1; i >= 0; i--)
        {
            var b = _balls[i];
            if (!IsInstanceValid(b.Body)) { _balls.RemoveAt(i); continue; }

            b.Age += dt;
            Vector3 pos = b.Body.GlobalPosition;
            float distToBoss = pos.DistanceTo(b.Boss.GlobalPosition);

            bool hit = distToBoss <= BallRadius + 0.5f;
            bool timeout = b.Age >= FlightTime + 0.5f;
            if (hit || timeout)
            {
                Detonate(pos);
                b.Body.QueueFree();
                _balls.RemoveAt(i);
            }
        }
    }

    private void Detonate(Vector3 at)
    {
        // ApplyExplosion self-culls by distance and only breaks props whose
        // hidden health it depletes, so iterate the whole group and let each
        // prop decide whether it survives.
        int affected = 0;
        foreach (Node n in GetTree().GetNodesInGroup("shatterable"))
        {
            if (n is Shatterable s && IsInstanceValid(s))
            {
                s.ApplyExplosion(at, ExplosionDamage, ExplosionRadius);
                affected++;
            }
        }
        GD.Print($"BallLauncher: detonation applied to {affected} props.");
    }

    private class Ball
    {
        public RigidBody3D Body;
        public Node3D Boss;
        public float Age;
    }
}
