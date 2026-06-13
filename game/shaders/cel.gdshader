shader_type spatial;
render_mode cull_back, diffuse_burley, specular_disabled;

// Per-material cel/toon shader.
// Each model's material keeps its OWN color by setting `albedo` to that
// material's original glTF baseColorFactor. Lighting is quantized into a few
// flat bands to produce the cel/toon look while preserving the base color.

uniform vec4 albedo : source_color = vec4(0.8, 0.8, 0.8, 1.0);
uniform int ramp_steps : hint_range(2, 6) = 3;
uniform float shadow_floor : hint_range(0.0, 1.0) = 0.25;
uniform float rim_strength : hint_range(0.0, 1.0) = 0.15;
uniform float fill_light : hint_range(0.0, 1.0) = 0.0;

void fragment() {
	ALBEDO = albedo.rgb;
	SPECULAR = 0.0;
	ROUGHNESS = 1.0;
}

void light() {
	// Quantize N.L into flat bands for the cel/toon look.
	float ndotl = clamp(dot(NORMAL, LIGHT), 0.0, 1.0);
	float stepped = floor(ndotl * float(ramp_steps) + 0.5) / float(ramp_steps);
	// Lift the darkest band off pure black so colors stay readable in shadow,
	// and so the directional light still defines clean banded steps even on
	// surfaces angled away from the key light.
	stepped = mix(shadow_floor, 1.0, stepped);
	// Flat fill keeps surfaces angled away from the key light from crushing to
	// black, so the base color stays readable across the whole model.
	stepped = max(stepped, fill_light);
	DIFFUSE_LIGHT += ALBEDO * LIGHT_COLOR.rgb * ATTENUATION * stepped;

	// Subtle rim to pop silhouettes.
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0) * rim_strength;
	DIFFUSE_LIGHT += rim * ALBEDO * LIGHT_COLOR.rgb * ATTENUATION;
}
