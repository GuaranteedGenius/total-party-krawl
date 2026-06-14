#[compute]
#version 450

// Screen-space cel outline.
// Edge detection over the depth buffer + the (converted) normal buffer, then
// composites a flat dark line onto the resolved scene color. Uniform line
// width, normal-independent -- works on every prop including the flat floor,
// which the old inverted-hull approach could not handle.

layout(local_size_x = 8, local_size_y = 8, local_size_z = 1) in;

// Resolved scene color (read + write, in place).
layout(rgba16f, set = 0, binding = 0) uniform image2D color_image;
// Depth pre-pass buffer (non-linear, reverse-Z in Forward+).
layout(set = 0, binding = 1) uniform sampler2D depth_tex;
// Packed normal-roughness buffer from the depth pre-pass.
layout(set = 0, binding = 2) uniform sampler2D normal_roughness_tex;

layout(push_constant, std430) uniform Params {
	vec2 raster_size;       // viewport size in pixels
	float depth_threshold;  // edge sensitivity on linear-ish depth delta
	float normal_threshold; // edge sensitivity on normal delta (0..2)
	vec4 line_color;        // flat fallback line color, a = strength
	float line_width;       // neighbor sample radius in pixels (line thickness)
	float line_darken;      // multiplier on local color when tinting (0..1)
	float tint_amount;      // 0 = flat line_color, 1 = darkened local color
	float _pad2;
} params;

// Convert Godot's packed normal-roughness buffer into view-space normals,
// matching what spatial shaders see. (engine: normal_roughness_compatibility)
vec3 decode_normal(vec4 nr) {
	return normalize(nr.xyz * 2.0 - 1.0);
}

// Evaluate whether there is an edge at sample-center `suv`, using a fixed
// 1-texel cross kernel (the only kernel size at which the depth-curvature test
// stays stable on grazing surfaces). Returns 1.0 on an edge, 0.0 otherwise.
float edge_at(vec2 suv, vec2 texel) {
	float dc = texture(depth_tex, suv).r;
	// Sky / cleared depth -> no geometry, no edge.
	if (dc <= 1e-5) {
		return 0.0;
	}
	float dl = texture(depth_tex, suv + vec2(-texel.x, 0.0)).r;
	float dr = texture(depth_tex, suv + vec2( texel.x, 0.0)).r;
	float du = texture(depth_tex, suv + vec2(0.0, -texel.y)).r;
	float dd = texture(depth_tex, suv + vec2(0.0,  texel.y)).r;

	// Depth edge via a curvature (2nd-derivative / Laplacian-style) test, made
	// scale-invariant by dividing by the local depth. A flat surface receding
	// from the camera has a near-constant depth GRADIENT, so opposite neighbors
	// average back to the center and the curvature stays ~0 even at grazing
	// angles like our floor. A real silhouette/crease breaks that symmetry and
	// spikes the curvature, which is what we want to outline.
	float curve_x = abs(dl + dr - 2.0 * dc);
	float curve_y = abs(du + dd - 2.0 * dc);
	float depth_edge = (curve_x + curve_y) / max(dc, 1e-5);

	vec3 nc = decode_normal(texture(normal_roughness_tex, suv));
	vec3 nl = decode_normal(texture(normal_roughness_tex, suv + vec2(-texel.x, 0.0)));
	vec3 nr2 = decode_normal(texture(normal_roughness_tex, suv + vec2( texel.x, 0.0)));
	vec3 nu = decode_normal(texture(normal_roughness_tex, suv + vec2(0.0, -texel.y)));
	vec3 nd = decode_normal(texture(normal_roughness_tex, suv + vec2(0.0,  texel.y)));

	// Normal edge: sum of (1 - dot) over neighbors. Larger where normals diverge.
	float normal_edge = (1.0 - dot(nc, nl))
		+ (1.0 - dot(nc, nr2))
		+ (1.0 - dot(nc, nu))
		+ (1.0 - dot(nc, nd));

	float depth_line = step(params.depth_threshold, depth_edge);
	float normal_line = step(params.normal_threshold, normal_edge);
	return max(depth_line, normal_line);
}

void main() {
	ivec2 uv = ivec2(gl_GlobalInvocationID.xy);
	ivec2 size = ivec2(params.raster_size);
	if (uv.x >= size.x || uv.y >= size.y) {
		return;
	}

	vec2 texel = 1.0 / params.raster_size;
	vec2 suv = (vec2(uv) + 0.5) * texel;

	// Detect the edge at this pixel, then DILATE: a pixel is part of the line if
	// any sample within `line_width` texels is an edge. Each sub-test uses the
	// stable 1-texel kernel, so thicker lines don't corrupt the floor.
	float line = edge_at(suv, texel);
	int radius = int(ceil(params.line_width - 1.0));
	for (int dy = -radius; dy <= radius && line < 1.0; dy++) {
		for (int dx = -radius; dx <= radius; dx++) {
			if (dx == 0 && dy == 0) {
				continue;
			}
			// Round mask so the line caps stay rounded, not boxy.
			if (float(dx * dx + dy * dy) > params.line_width * params.line_width) {
				continue;
			}
			line = max(line, edge_at(suv + vec2(float(dx), float(dy)) * texel, texel));
			if (line >= 1.0) {
				break;
			}
		}
	}

	line *= params.line_color.a;

	vec4 src = imageLoad(color_image, uv);

	// Tint the line from a darkened average of the surrounding scene colors, so the
	// outline reads as a soft shaded crease that follows the local mesh color rather
	// than a hard inked line. `tint_amount` blends between the flat fallback color
	// and this color-derived tint.
	vec3 acc = vec3(0.0);
	for (int dy = -1; dy <= 1; dy++) {
		for (int dx = -1; dx <= 1; dx++) {
			ivec2 c = clamp(uv + ivec2(dx, dy), ivec2(0), size - 1);
			acc += imageLoad(color_image, c).rgb;
		}
	}
	vec3 local_tint = (acc / 9.0) * params.line_darken;
	vec3 line_rgb = mix(params.line_color.rgb, local_tint, params.tint_amount);

	vec3 outc = mix(src.rgb, line_rgb, line);
	imageStore(color_image, uv, vec4(outc, src.a));
}
