# Reference images in Tile mode

Use a PNG, JPEG or WebP map as a tracing guide while building terrain. In a
Procedural project, open **Terrain → Import → Reference Image**. In Mini,
Manual or Nodes projects, use the **Reference Image** tool in the toolbar.

1. Choose your image, then switch the camera to the top view for alignment.
2. Adjust **Reference Scale**. At 1, the longest image side spans one tile;
   the original aspect ratio is preserved.
3. Adjust **Reference Position X/Z** in tile units, relative to the center of
   the origin tile. One unit moves the image by one tile width.
4. Set **Reference Opacity** and sculpt or paint the terrain as usual.
   **Show Reference** hides the guide without removing it. **Remove Reference**
   removes the image and frees its graphics resources. Replacing an image
   keeps the alignment and visibility controls.

This is a flat horizontal guide at world height zero, drawn over the viewport.
It does not infer elevations, follow the relief, change biomes, or intercept
editing clicks. Use the top view to avoid perspective differences between
the guide and elevated terrain. Tile dimensions also determine the guide's
size and position, so changing tile size scales both together.

The guide appears during Tile editing, including Mini and Manual Terrain.
Planet, Infinite and exploration views hide it while retaining its settings. It is absent from
heightmaps, terrain meshes, runtime exports, minimaps, water reflections,
screenshots, and project preview thumbnails.

Local saves and portable `.ptrterrain` files embed the decoded PNG and all
controls; reopening does not require the source file or a network request.
Images above 4096 pixels on either side are downscaled using the existing
image importer. Embedded images increase project and undo-history size.
As with other local textures, projects containing a reference image cannot
be uploaded to the cloud; use a portable project file instead.

## Implementation and checks

`Engine.importTileMap('reference', file)` reuses the worker-compatible image
decoder and imported-map UI state, but never calls terrain texture rebuilding
or `applyAll`. `ReferenceImageLayer` owns a separate Three.js scene, one RGBA
texture and a non-pickable plane. The Tile viewport renders it after the
existing camera/postprocessing pipeline; export and capture paths omit it.

The versioned `referenceImage` project field holds PNG data and normalized
settings. Only embedded PNG data URLs are accepted on restore. Import request
tokens prevent late decodes from replacing newer images or resurrecting a
removed image. Replacement, removal and engine disposal release resources.

Run `npm test` for import, controls, race handling, persistence, mode isolation,
capture exclusion and UI/worker regressions. Run
`node tools/check-reference-image-browser.mjs` for actual WebGL pixel checks
of orientation, alpha, opacity, transforms, mode isolation and portable
roundtripping. Set `TERRAIN_BROWSER_PATH` to an installed Chromium browser
when the Playwright browser is unavailable.
