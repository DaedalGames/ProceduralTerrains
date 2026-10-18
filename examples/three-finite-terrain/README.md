# Independent Three.js example

## Other runtime modules

The same scene/renderer/loop can run the other worlds with URL parameters:

- `/?mode=infinite`
- `/?mode=planet&clouds=realistic`
- `/?mode=mini&water=volumetric`
- `/?water=cinematic&clouds=legacy`

The package owns no controls, React root or Electron window. This example owns
its OrbitControls, canvas resizing and loop, and disposes them on page exit.
`matrix.html` is the browser validation fixture for sources, effects, workers,
PBR assets and exports. Its test pack is served only by the browser test tool.
