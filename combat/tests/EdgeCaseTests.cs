using Xunit;

namespace TotalPartyKrawl.Combat.Tests;

/// <summary>Spec §6 edge cases.</summary>
public sealed class EdgeCaseTests
{
    private static CombatEngine Fight(out CombatState state, Random? rng = null,
        params (string ClassId, int Seat, string Id)[] party)
    {
        var engine = CombatEngine.CreateFight(
            party.Length == 0
                ? new[] { (DefaultContent.ClassTank, 0, "Tank"), (DefaultContent.ClassMage, 1, "Mage"), (DefaultContent.ClassHealer, 2, "Healer") }
                : party,
            DefaultContent.Classes(), DefaultContent.Warden(), DefaultContent.Moves(),
            DefaultContent.Tuning(), rng ?? FixedRng.NeverDodge);
        state = engine.State;
        return engine;
    }

    [Fact] // §6.2 — a combatant killed before it acts does not get to act.
    public void DeadCombatant_DoesNotAct()
    {
        var engine = Fight(out var state);
        var mage = state.ById("Mage")!;
        mage.CurrentHp = 1; // boss (DEX6) acts last; Mage (DEX9) acts first but we kill it pre-round

        // Force the Mage dead before resolution by simulating a prior lethal state.
        mage.CurrentHp = 0;
        long bossHpBefore = state.Boss.CurrentHp;

        engine.SubmitLock("Mage", DefaultContent.MageFireball, "boss"); // would do 35 if it acted
        engine.SubmitLock("Tank", DefaultContent.BasicAttack, "boss");
        engine.SubmitLock("Healer", DefaultContent.BasicAttack, "boss");
        engine.SubmitLock("boss", DefaultContent.BossCrushingBlow, "Tank");

        engine.ResolveRound();

        // Boss lost only Tank+Healer basic attacks, NOT the dead Mage's 35 Fireball.
        Assert.True(state.Boss.CurrentHp > bossHpBefore - 35);
    }

    [Fact] // §6.5 — overheal is clamped to MaxHp.
    public void Overheal_ClampedToMaxHp()
    {
        var engine = Fight(out var state);
        var healer = state.ById("Healer")!;
        healer.CurrentHp = healer.MaxHp - 5; // only 5 missing, heal is 34

        engine.SubmitLock("Healer", DefaultContent.HealerHeal, "Healer");
        engine.SubmitLock("Tank", DefaultContent.BasicAttack, "boss");
        engine.SubmitLock("Mage", DefaultContent.BasicAttack, "boss");
        engine.SubmitLock("boss", DefaultContent.BossBrace, "boss"); // keep boss off the party

        engine.ResolveRound();

        Assert.Equal(healer.MaxHp, healer.CurrentHp);
    }

    [Fact] // §6.5 — heal cannot target a dead ally; re-targets (defaults) instead.
    public void Heal_CannotTargetDeadAlly()
    {
        var engine = Fight(out var state);
        var mage = state.ById("Mage")!;
        mage.CurrentHp = 0; // Mage is dead
        var healer = state.ById("Healer")!;
        healer.CurrentHp = 50;

        engine.SubmitLock("Healer", DefaultContent.HealerHeal, "Mage"); // tries to heal the corpse
        engine.SubmitLock("Tank", DefaultContent.BasicAttack, "boss");
        engine.SubmitLock("boss", DefaultContent.BossBrace, "boss");

        engine.ResolveRound();

        // Mage stays dead (no resurrection); the heal fell back to a valid ally (self).
        Assert.Equal(0, mage.CurrentHp);
        Assert.False(mage.IsAlive);
        Assert.True(healer.CurrentHp > 50); // heal redirected to self
    }

    [Fact] // §6.1 — boss death wins ties: a faster viewer kills the boss the same round
           // the last other party member is down, and viewers are awarded the win.
    public void SimultaneousDeath_BossDeathWinsTie()
    {
        // Initiative: Mage (DEX9) acts before the boss (DEX6). The Mage's Fireball kills the
        // boss; the Tank is already at 0 from earlier chip. At END the boss is dead — even
        // with the party on the brink, the §6.1 rule awards the win to the viewers.
        var engine = Fight(out var state,
            party: new[] { (DefaultContent.ClassMage, 0, "Mage"), (DefaultContent.ClassTank, 1, "Tank") });
        var mage = state.ById("Mage")!;
        var tank = state.ById("Tank")!;
        var boss = state.Boss;

        boss.CurrentHp = 5;  // Mage Fireball (35) kills the boss this round
        tank.CurrentHp = 0;  // already down
        mage.CurrentHp = 1;  // on death's door

        engine.SubmitLock("Mage", DefaultContent.MageFireball, "boss");
        engine.SubmitLock("boss", DefaultContent.BossCrushingBlow, "Mage");

        engine.ResolveRound();

        Assert.False(boss.IsAlive);
        Assert.Equal(Phase.Won, state.Phase); // boss death wins (spec §6.1)
    }

    [Fact] // §6.1 — party wipe (no living viewer at END) → boss wins.
    public void PartyWipe_BossWins()
    {
        var engine = Fight(out var state,
            party: new[] { (DefaultContent.ClassMage, 0, "Mage") });
        var mage = state.ById("Mage")!;
        var boss = state.Boss;

        boss.CurrentHp = boss.MaxHp; // boss survives the Mage's chip
        mage.CurrentHp = 1;          // boss Crushing Blow finishes the Mage

        engine.SubmitLock("Mage", DefaultContent.BasicAttack, "boss");
        engine.SubmitLock("boss", DefaultContent.BossCrushingBlow, "Mage");

        engine.ResolveRound();

        Assert.False(mage.IsAlive);
        Assert.Equal(Phase.Lost, state.Phase);
    }

    [Fact] // §6.3 — AOE ignores taunt: Quake hits everyone incl. the taunting Tank.
    public void Aoe_IgnoresTaunt_HitsWholeParty()
    {
        var engine = Fight(out var state);
        // Tank taunts; boss casts Quake (EnemyAll) — should hit Mage + Healer too.
        engine.SubmitLock("Tank", DefaultContent.TankTaunt, "Tank");
        engine.SubmitLock("Mage", DefaultContent.BasicAttack, "boss");
        engine.SubmitLock("Healer", DefaultContent.BasicAttack, "boss");
        engine.SubmitLock("boss", DefaultContent.BossQuake, null);

        int mageHpBefore = state.ById("Mage")!.CurrentHp;
        int healerHpBefore = state.ById("Healer")!.CurrentHp;

        engine.ResolveRound();

        Assert.True(state.ById("Mage")!.CurrentHp < mageHpBefore);     // Mage took Quake despite taunt
        Assert.True(state.ById("Healer")!.CurrentHp < healerHpBefore); // Healer too
    }

    [Fact] // §4.4 — match must not start with 0 viewers.
    public void ZeroViewers_FightRefusesToStart()
    {
        Assert.Throws<InvalidOperationException>(() =>
            CombatEngine.CreateFight(
                Array.Empty<(string, int, string)>(),
                DefaultContent.Classes(), DefaultContent.Warden(), DefaultContent.Moves(),
                DefaultContent.Tuning(), FixedRng.NeverDodge));
    }

    [Fact] // §6.6 — a dodged attack deals 0 (heals/taunt are never dodged).
    public void DodgedAttack_DealsNoDamage()
    {
        var engine = Fight(out var state, rng: FixedRng.AlwaysDodge);
        int bossHpBefore = state.Boss.CurrentHp;

        engine.SubmitLock("Mage", DefaultContent.MageFireball, "boss");
        engine.SubmitLock("Tank", DefaultContent.BasicAttack, "boss");
        engine.SubmitLock("Healer", DefaultContent.HealerHeal, "Healer");
        engine.SubmitLock("boss", DefaultContent.BossBrace, "boss");

        engine.ResolveRound();

        // All attacks dodged → boss took no damage from the party this round.
        Assert.Equal(bossHpBefore, state.Boss.CurrentHp);
    }
}
