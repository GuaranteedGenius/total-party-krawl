shader_type spatial;
render_mode cull_front, unshaded, shadows_disabled;

// Inverted-hull outline. Rendered as a next_pass on each cel material:
// back-faces are pushed out along their normals and shaded a flat dark color,
// producing a clean dark outline around each object's silhouette.

uniform float outline_width : hint_range(0.0, 0.1) = 0.02;
uniform vec4 outline_color : source_color = vec4(0.05, 0.04, 0.06, 1.0);

void vertex() {
	VERTEX += normalize(NORMAL) * outline_width;
}

void fragment() {
	ALBEDO = outline_color.rgb;
}
