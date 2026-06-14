extends Node
# Autoload helper: when env var TPK_SCREENSHOT is set to an output path,
# capture the viewport after a short delay and quit. Otherwise no-op.

func _ready() -> void:
	# Multi-shot mode for the combat scene: capture several frames at staggered
	# times so we can see the fight at the start, mid-fight, and at the win banner.
	# TPK_COMBAT_SHOTS = "path1@t1,path2@t2,..." where tN is seconds from load.
	var combat_shots := OS.get_environment("TPK_COMBAT_SHOTS")
	if combat_shots != "":
		await _run_combat_shots(combat_shots)
		return

	var out_path := OS.get_environment("TPK_SCREENSHOT")
	if out_path == "":
		return
	# Let the scene render and physics settle a few frames.
	await get_tree().create_timer(0.6).timeout
	# Optional: fire the "destruct" action and let Jolt scatter the fragments
	# before capturing. Gated on TPK_DESTRUCT so normal runs are unaffected.
	if OS.get_environment("TPK_DESTRUCT") != "":
		var ev := InputEventKey.new()
		ev.physical_keycode = KEY_SPACE
		ev.pressed = true
		Input.parse_input_event(ev)
		await get_tree().create_timer(1.6).timeout
	# Optional: fire a left-click to launch the wrecking ball, then let it fly
	# and the scenery settle before capturing. Gated on TPK_AUTOFIRE.
	if OS.get_environment("TPK_AUTOFIRE") != "":
		var down := InputEventMouseButton.new()
		down.button_index = MOUSE_BUTTON_LEFT
		down.pressed = true
		Input.parse_input_event(down)
		var up := InputEventMouseButton.new()
		up.button_index = MOUSE_BUTTON_LEFT
		up.pressed = false
		Input.parse_input_event(up)
		await get_tree().create_timer(1.6).timeout
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(out_path)
	if err != OK:
		push_error("screenshot_on_ready: failed to save %s (err %d)" % [out_path, err])
	get_tree().quit()

func _run_combat_shots(spec: String) -> void:
	# Parse "path@seconds" entries, sort by time, capture each at its absolute
	# offset from scene load, then quit. Lets the auto-playing combat scene be
	# sampled at several distinct fight moments in one headless run.
	var shots := []
	for entry in spec.split(","):
		var parts := entry.split("@")
		if parts.size() != 2:
			continue
		shots.append({"path": parts[0], "t": float(parts[1])})
	shots.sort_custom(func(a, b): return a["t"] < b["t"])

	var elapsed := 0.0
	for shot in shots:
		var wait_for: float = shot["t"] - elapsed
		if wait_for > 0.0:
			await get_tree().create_timer(wait_for).timeout
			elapsed = shot["t"]
		var img := get_viewport().get_texture().get_image()
		var err := img.save_png(shot["path"])
		if err != OK:
			push_error("combat_shots: failed to save %s (err %d)" % [shot["path"], err])
		else:
			print("combat_shots: captured %s at t=%.1fs" % [shot["path"], elapsed])
	get_tree().quit()
