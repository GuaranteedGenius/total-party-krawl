extends Node
# Autoload helper: when env var TPK_SCREENSHOT is set to an output path,
# capture the viewport after a short delay and quit. Otherwise no-op.

func _ready() -> void:
	var out_path := OS.get_environment("TPK_SCREENSHOT")
	if out_path == "":
		return
	# Let the scene render and physics settle a few frames.
	await get_tree().create_timer(0.6).timeout
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(out_path)
	if err != OK:
		push_error("screenshot_on_ready: failed to save %s (err %d)" % [out_path, err])
	get_tree().quit()
