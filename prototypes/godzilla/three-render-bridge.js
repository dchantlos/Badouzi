import {
  DepthFormat, DepthStencilFormat, DepthTexture, FloatType, HalfFloatType,
  LinearFilter, LinearSRGBColorSpace, NearestFilter, NoColorSpace, NoToneMapping,
  UnsignedByteType, UnsignedInt248Type, UnsignedIntType, UnsignedShortType,
  WebGLRenderer, WebGLRenderTarget
} from "three";

export function createThreeRenderBridge(gl) {
  // ArcGIS image-upload flags are invalid for Three's initial 3D placeholder textures.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  for (const parameter of [
    gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS,
    gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES
  ]) gl.pixelStorei(parameter, 0);
  const renderer = new WebGLRenderer({
    canvas: gl.canvas, context: gl, antialias: false, alpha: true
  });
  renderer.autoClear = false;
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  let shaderError;
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    const details = [context.getProgramInfoLog(program), context.getShaderInfoLog(vertex), context.getShaderInfoLog(fragment)]
      .filter(message => message?.trim()).map(message => message.trim()).join("\n");
    shaderError = new Error(`Three.js wake shader compilation failed: ${details}`);
  };
  let sceneCopy, working;
  let key = "";
  let disposed = false;
  const maxDrawBuffers = gl.getParameter(gl.MAX_DRAW_BUFFERS);

  function check(operation) {
    const errors = [];
    for (let error = gl.getError(); error !== gl.NO_ERROR; error = gl.getError()) errors.push(error);
    if (errors.length) throw new Error(`${operation} failed (WebGL ${errors.join(", ")})`);
  }
  function targets(width, height) {
    const parameter = (attachment, name) =>
      gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, attachment, name);
    const colorType = parameter(gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE);
    const colorBits = parameter(gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_RED_SIZE);
    const encoding = parameter(gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING);
    const depthType = parameter(gl.DEPTH_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE);
    const depthBits = parameter(gl.DEPTH_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE);
    const stencilBits = parameter(gl.STENCIL_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE);
    if (!depthBits) throw new Error("ArcGIS did not provide scene depth for the water shader");
    const nextKey = [width, height, colorType, colorBits, encoding, depthType, depthBits, stencilBits].join("/");
    if (nextKey === key) return;
    sceneCopy?.dispose();
    working?.dispose();
    const type = colorType === gl.FLOAT ? (colorBits > 16 ? FloatType : HalfFloatType) : UnsignedByteType;
    const internalFormat = colorType === gl.FLOAT ? (colorBits > 16 ? "RGBA32F" : "RGBA16F")
      : encoding === gl.SRGB ? "SRGB8_ALPHA8" : "RGBA8";
    const depth = new DepthTexture(width, height,
      depthType === gl.FLOAT ? FloatType : stencilBits ? UnsignedInt248Type
        : depthBits <= 16 ? UnsignedShortType : UnsignedIntType);
    depth.format = stencilBits ? DepthStencilFormat : DepthFormat;
    depth.minFilter = depth.magFilter = NearestFilter;
    sceneCopy = new WebGLRenderTarget(width, height, {
      type, depthBuffer: true, stencilBuffer: !!stencilBits, depthTexture: depth,
      minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false
    });
    working = new WebGLRenderTarget(width, height, {
      type, depthBuffer: false, stencilBuffer: false,
      minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false
    });
    for (const target of [sceneCopy, working]) {
      target.texture.internalFormat = internalFormat;
      target.texture.colorSpace = NoColorSpace;
    }
    key = nextKey;
  }
  function draw(node, scene, camera, updateUniforms) {
    if (disposed || gl.isContextLost()) throw new Error("The shared water-rendering context is unavailable");
    renderer.resetState();
    // Three unbinds framebuffers; restore ArcGIS's bindings and cache afterward.
    node.resetWebGLState();
    const output = node.bindRenderTarget();
    let nativeFramebuffer, drawBuffers, readBuffer;
    let failure = null;
    try {
      nativeFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      drawBuffers = Array.from({ length: maxDrawBuffers }, (_, index) => gl.getParameter(gl.DRAW_BUFFER0 + index));
      while (drawBuffers.length > 1 && drawBuffers.at(-1) === gl.NONE) drawBuffers.pop();
      readBuffer = gl.getParameter(gl.READ_BUFFER);
      const width = node.camera.viewport[2], height = node.camera.viewport[3];
      check("ArcGIS framebuffer handoff");
      targets(width, height);
      renderer.setRenderTarget(sceneCopy);
      const copyFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, nativeFramebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copyFramebuffer);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height,
        gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | (sceneCopy.stencilBuffer ? gl.STENCIL_BUFFER_BIT : 0), gl.NEAREST);
      check("Copying ArcGIS scene color and depth");

      renderer.setRenderTarget(working);
      const workFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, copyFramebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, workFramebuffer);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      check("Preparing the Three.js water target");

      renderer.resetState();
      renderer.setRenderTarget(working);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      updateUniforms({
        color: sceneCopy.texture, depth: sceneCopy.depthTexture, width, height
      });
      renderer.render(scene, camera);
      check(shaderError?.message || "Rendering the Three.js water shader");
      if (shaderError) throw shaderError;

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, workFramebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, nativeFramebuffer);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      check("Returning water color to ArcGIS");
    } catch (error) {
      failure = error;
    } finally {
      // The scene owns these attachments, including its glow buffer.
      if (nativeFramebuffer) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, nativeFramebuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, nativeFramebuffer);
        if (readBuffer != null) gl.readBuffer(readBuffer);
        if (drawBuffers?.length) gl.drawBuffers(drawBuffers);
      }
      renderer.resetState();
      node.resetWebGLState();
    }
    return { output, error: failure };
  }
  return {
    draw,
    get stats() {
      return {
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sceneCopy?.dispose();
      working?.dispose();
      renderer.dispose();
    }
  };
}
