extends Node
# Autoload helper: when env var TPK_SCREENSHOT is set to an output path,
# capture the viewport after a short delay and quit. Otherwise no-op.

func _ready() -> void:
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
