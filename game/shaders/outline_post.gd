@tool
extends CompositorEffect
class_name OutlinePostEffect

# Screen-space cel outline as a Godot 4.5 CompositorEffect.
# Runs a compute shader after opaque geometry, reads the resolved color, the
# depth pre-pass, and the normal-roughness buffer, and composites a flat dark
# edge line. Replaces the fragile per-material inverted-hull outline: lines are
# uniform width, normal-independent, and apply to every surface (incl. floor).

@export var line_color: Color = Color(0.05, 0.04, 0.06, 1.0)
@export_range(0.0, 1.0) var line_strength: float = 1.0
# Depth edge sensitivity. Lower = more lines (catches subtler depth steps).
@export_range(0.00001, 0.05) var depth_threshold: float = 0.0008
# Normal edge sensitivity (sum of 1-dot over a 4-neighbor cross, range ~0..8).
@export_range(0.0, 4.0) var normal_threshold: float = 0.55
# Line thickness in pixels (neighbor sample radius).
@export_range(1.0, 4.0) var line_width: float = 1.5
# How dark the color-derived line is (multiplier on the local averaged color).
@export_range(0.0, 1.0) var line_darken: float = 0.45
# Blend between the flat line_color (0) and the darkened local color (1).
@export_range(0.0, 1.0) var tint_amount: float = 1.0

var rd: RenderingDevice
var shader: RID
var pipeline: RID

# Nearest-clamp sampler RID for the depth/normal textures.
var nearest_sampler: RID


func _init() -> void:
	effect_callback_type = CompositorEffect.EFFECT_CALLBACK_TYPE_POST_TRANSPARENT
	access_resolved_color = true
	needs_normal_roughness = true
	rd = RenderingServer.get_rendering_device()
	if rd:
		RenderingServer.call_on_render_thread(_initialize_compute)


func _initialize_compute() -> void:
	if not rd:
		return
	var shader_file: RDShaderFile = load("res://shaders/outline_post.glsl")
	var spirv: RDShaderSPIRV = shader_file.get_spirv()
	shader = rd.shader_create_from_spirv(spirv)
	if shader.is_valid():
		pipeline = rd.compute_pipeline_create(shader)

	var s := RDSamplerState.new()
	s.min_filter = RenderingDevice.SAMPLER_FILTER_NEAREST
	s.mag_filter = RenderingDevice.SAMPLER_FILTER_NEAREST
	s.repeat_u = RenderingDevice.SAMPLER_REPEAT_MODE_CLAMP_TO_EDGE
	s.repeat_v = RenderingDevice.SAMPLER_REPEAT_MODE_CLAMP_TO_EDGE
	nearest_sampler = rd.sampler_create(s)


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		if shader.is_valid():
			rd.free_rid(shader)
		if nearest_sampler.is_valid():
			rd.free_rid(nearest_sampler)


func _render_callback(p_effect_callback_type: int, p_render_data: RenderData) -> void:
	if not rd or p_effect_callback_type != CompositorEffect.EFFECT_CALLBACK_TYPE_POST_TRANSPARENT:
		return
	if not pipeline.is_valid():
		return

	var render_scene_buffers: RenderSceneBuffersRD = p_render_data.get_render_scene_buffers()
	if not render_scene_buffers:
		return

	var size: Vector2i = render_scene_buffers.get_internal_size()
	if size.x == 0 or size.y == 0:
		return

	var x_groups := int((size.x - 1) / 8 + 1)
	var y_groups := int((size.y - 1) / 8 + 1)

	# Push constants: vec2 size, two floats, vec4 color, line_width + 3 pad.
	# Total 12 floats = 48 bytes (16-byte aligned).
	var push := PackedFloat32Array([
		float(size.x), float(size.y),
		depth_threshold, normal_threshold,
		line_color.r, line_color.g, line_color.b, line_strength,
		line_width, line_darken, tint_amount, 0.0,
	])
	var push_bytes := push.to_byte_array()

	var view_count: int = render_scene_buffers.get_view_count()
	for view in range(view_count):
		var color_image: RID = render_scene_buffers.get_color_layer(view)
		var depth_image: RID = render_scene_buffers.get_depth_layer(view)
		var normal_image: RID = render_scene_buffers.get_texture_slice(
			"forward_clustered", "normal_roughness", view, 0, 1, 1)

		# binding 0: color image (read/write)
		var u_color := RDUniform.new()
		u_color.uniform_type = RenderingDevice.UNIFORM_TYPE_IMAGE
		u_color.binding = 0
		u_color.add_id(color_image)

		# binding 1: depth as sampled texture
		var u_depth := RDUniform.new()
		u_depth.uniform_type = RenderingDevice.UNIFORM_TYPE_SAMPLER_WITH_TEXTURE
		u_depth.binding = 1
		u_depth.add_id(nearest_sampler)
		u_depth.add_id(depth_image)

		# binding 2: normal-roughness as sampled texture
		var u_normal := RDUniform.new()
		u_normal.uniform_type = RenderingDevice.UNIFORM_TYPE_SAMPLER_WITH_TEXTURE
		u_normal.binding = 2
		u_normal.add_id(nearest_sampler)
		u_normal.add_id(normal_image)

		var uniform_set := UniformSetCacheRD.get_cache(shader, 0, [u_color, u_depth, u_normal])

		var compute_list := rd.compute_list_begin()
		rd.compute_list_bind_compute_pipeline(compute_list, pipeline)
		rd.compute_list_bind_uniform_set(compute_list, uniform_set, 0)
		rd.compute_list_set_push_constant(compute_list, push_bytes, push_bytes.size())
		rd.compute_list_dispatch(compute_list, x_groups, y_groups, 1)
		rd.compute_list_end()
