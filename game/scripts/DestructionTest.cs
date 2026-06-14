using Godot;

// Art-test destruction proof: on the "destruct" trigger (Space), shatter every
// Shatterable prop in the scene with a self-centered burst. The actual fragment
// swap + physics lives in the reusable Shatterable component.
//
// NOTE: Space intentionally bypasses hidden health -- it calls Shatter()
// directly so we keep an easy "nuke everything" for testing the fragment
// system. Proximity/health-based breakage lives in BallLauncher.ApplyExplosion.
public partial class DestructionTest : Node3D
{
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

        var nodes = GetTree().GetNodesInGroup("shatterable");
        GD.Print($"DestructionTest: shattering {nodes.Count} props.");
        foreach (Node n in nodes)
            if (n is Shatterable s)
                s.Shatter(((Node3D)n).GlobalPosition); // self-centered burst
    }
}
