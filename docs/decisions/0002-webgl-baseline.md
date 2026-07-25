# ADR 0002: WebGL is the baseline renderer

Status: accepted

The Wails application runs inside platform webviews whose WebGPU capabilities
are not uniform. Three.js WebGL is therefore the required rendering path.
WebGPU may be added later through capability detection, but features must retain
a WebGL implementation.
