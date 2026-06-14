namespace TotalPartyKrawl.Combat.Tests;

/// <summary>
/// A deterministic <see cref="Random"/> for dodge tests. NextDouble() returns a
/// fixed value so dodge resolves predictably:
///   0.99 → roll 99.0, never below any dodge pct → "never dodged" (the §7 oracle).
///   0.00 → roll 0.0, below any positive dodge pct → "always dodged".
/// </summary>
public sealed class FixedRng(double value) : Random
{
    public override double NextDouble() => value;

    public static FixedRng NeverDodge => new(0.99);
    public static FixedRng AlwaysDodge => new(0.0);
}
