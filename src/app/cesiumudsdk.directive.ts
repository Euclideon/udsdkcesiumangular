declare module "cesium" {
  class Texture { constructor(obj: any); }
  class Sampler { constructor(obj: any); }
  class VertexArray { constructor(obj: any); static fromGeometry(obj: any): VertexArray; }
  class ShaderProgram { constructor(obj: any); static fromCache(obj: any): ShaderProgram; }
  class ShaderSource { constructor(obj: any); }
  class DrawCommand { constructor(obj: any); }
  class RenderState { constructor(obj: any); static fromCache(obj: any): RenderState;  }

  enum Pass {
    OPAQUE
  }

  enum BufferUsage {
    DYNAMIC_DRAW,
    STATIC_DRAW,
    STREAM_DRAW
  }
}

export interface Module {
  arguments?: string[];
  canvas?: HTMLElement | undefined;
  noInitialRun?: boolean;
  mainScriptUrlOrBlob?: string;
  preRun:(() => void)[];
  onRuntimeInitialized():void;
  setStatusLast: { text: string; };
  setStatus(msg: string): void;

  ccall(ident: string, returnType?: string, argTypes?: string[], args?: any[]): number | void;
  addFunction(callback: Function, signature: string): number;
  removeFunction(callbackPtr: number): void;

  _malloc(size: number): number;
  _free(ptr: number): void;
}

declare global {
  var Module: Module;
  function UTF8ToString(ptr: number, maxBytesToRead?: number): string;
  function getValue(ptr: number, type: string): number;
}

import { Directive, ElementRef, OnInit } from '@angular/core';
import { GeometryAttribute } from 'cesium';
import { Appearance } from 'cesium';
import { PrimitiveType, destroyObject, Cartesian3, PolylineGlowMaterialProperty, Color, BoundingSphere } from 'cesium';
import { defined } from 'cesium';
import { ComponentDatatype } from 'cesium';
import { Geometry, RenderState } from 'cesium';
import { PixelFormat, Pass, BufferUsage } from 'cesium';
import { Credit, UrlTemplateImageryProvider, Viewer, Texture, VertexArray, ShaderProgram, ShaderSource, DrawCommand } from 'cesium';

// easyudsdk
declare function udSDKJS_ResizeScene(width:number, height:number, colourBuffer:number, depthBuffer:number):number;
declare function udSDKJS_SetMatrix(matrixType:string, a0:number, a1:number, a2:number, a3:number, a4:number, a5:number, a6:number, a7:number, a8:number, a9:number, a10:number, a11:number, a12:number, a13:number, a14:number, a15:number):number;
declare function udSDKJS_RegisterShared():void;
declare function udSDKJS_CreateFrom_udCloud(appName:string):any;
declare function udSDKJS_RenderQueue():number;
declare function udSDKJS_GetColourBuffer():number;
declare function udSDKJS_GetDepthBuffer():number;
declare function udSDKJS_IsPointVisible(point1Coordinates: Cartesian3, point2Coordinates: Cartesian3, rayWidth: any):number;
declare function udSDKJS_LoadModel(modelLocation: string):any;
declare function udSDKJS_RenderQueueAddModel(handle: number, zOffset: number, targetzone: number):number;
declare function udSDKJS_RenderQueueItem_SetClassification(slotid: number):number;
declare function udSDKJS_GetErrorString(code: number):string;

declare var HEAPU8:any;

// component variables
var udSDKReady = 0;

var lineEntityPartA: any = undefined; // 'Visible' Section
var lineEntityPartB: any = undefined; // 'Hidden' Section
var lineEntityPartC: any = undefined; // 'Skipped' Section

var colourTextureGL: any;
var udTextureDepth: any;
var previousWidth = 16;
var previousHeight = 16;

var viewer: Viewer;

class VtxfPrimitive {
  prevWidth: number;
  prevHeight: number;
  show: boolean;
  _command: undefined;
  _createCommand: (context: {
    defaultTexture: any;
  }) => DrawCommand;

  constructor() {
    this.prevWidth = 0;
    this.prevHeight = 0;

    var positions = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
    var sts = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

    var context = (viewer.scene as any).context;
    colourTextureGL = new Texture({
      context: context,
      pixelFormat: PixelFormat.RGBA,
      width: previousWidth,
      height: previousHeight
    });

    udTextureDepth = new Texture({
      context: context,
      pixelFormat: PixelFormat.ALPHA,
      width: previousWidth,
      height: previousHeight
    });

    var attributeLocations = {
      position: 0,
      textureCoordinates: 1,
    };

    var vtxfVertexShader = `
        attribute vec2 position;
        attribute vec2 st;
        attribute float batchId;

        varying vec2 v_st;

        void main()
        {
            v_st = st;
            gl_Position = vec4(position, 1.0, 1.0);
        }
    `;

    var vtxfFragmentShader = `
    #extension GL_EXT_frag_depth : enable
    varying vec2 v_st;

    uniform sampler2D udImage;
    uniform sampler2D udDepth;

      //RGBA to Float from https://github.com/ihmeuw/glsl-rgba-to-float/blob/master/index.glsl
      // Denormalize 8-bit color channels to integers in the range 0 to 255.
      ivec4 floatsToBytes(vec4 inputFloats, bool littleEndian) {
        ivec4 bytes = ivec4(inputFloats * 255.0);
        return (
          littleEndian
          ? bytes.abgr
          : bytes
        );
      }

      // Break the four bytes down into an array of 32 bits.
      void bytesToBits(const in ivec4 bytes, out bool bits[32]) {
        for (int channelIndex = 0; channelIndex < 4; ++channelIndex) {
          float acc = float(bytes[channelIndex]);
          for (int indexInByte = 7; indexInByte >= 0; --indexInByte) {
            float powerOfTwo = exp2(float(indexInByte));
            bool bit = acc >= powerOfTwo;
            bits[channelIndex * 8 + (7 - indexInByte)] = bit;
            acc = mod(acc, powerOfTwo);
          }
        }
      }

      // Compute the exponent of the 32-bit float.
      float getExponent(bool bits[32]) {
        const int startIndex = 1;
        const int bitStringLength = 8;
        const int endBeforeIndex = startIndex + bitStringLength;
        float acc = 0.0;
        int pow2 = bitStringLength - 1;
        for (int bitIndex = startIndex; bitIndex < endBeforeIndex; ++bitIndex) {
          acc += float(bits[bitIndex]) * exp2(float(pow2--));
        }
        return acc;
      }

      // Compute the mantissa of the 32-bit float.
      float getMantissa(bool bits[32], bool subnormal) {
        const int startIndex = 9;
        const int bitStringLength = 23;
        const int endBeforeIndex = startIndex + bitStringLength;
        // Leading/implicit/hidden bit convention:
        // If the number is not subnormal (with exponent 0), we add a leading 1 digit.
        float acc = float(!subnormal) * exp2(float(bitStringLength));
        int pow2 = bitStringLength - 1;
        for (int bitIndex = startIndex; bitIndex < endBeforeIndex; ++bitIndex) {
          acc += float(bits[bitIndex]) * exp2(float(pow2--));
        }
        return acc;
      }

      // Parse the float from its 32 bits.
      float bitsToFloat(bool bits[32]) {
        float signBit = float(bits[0]) * -2.0 + 1.0;
        float exponent = getExponent(bits);
        bool subnormal = abs(exponent - 0.0) < 0.01;
        float mantissa = getMantissa(bits, subnormal);
        float exponentBias = 127.0;
        return signBit * mantissa * exp2(exponent - exponentBias - 23.0);
      }

      // Decode a 32-bit float from the RGBA color channels of a texel.
      float rgbaToFloat(vec4 texelRGBA, bool littleEndian) {
        ivec4 rgbaBytes = floatsToBytes(texelRGBA, littleEndian);
        bool bits[32];
        bytesToBits(rgbaBytes, bits);
        return bitsToFloat(bits);
      }

      void main()
      {
        gl_FragColor = texture2D(udImage, v_st).bgra;
        float distanceF = rgbaToFloat(texture2D(udDepth, v_st), true);

        if (distanceF == 1.0)
          discard;

        vec4 clipPosition = vec4(v_st * 2.0 - 1.0, distanceF, 1.0);
        vec4 eyePosition = czm_inverseProjection * clipPosition;
        eyePosition /= eyePosition.w;

        float distanceM = length((czm_inverseView * eyePosition).xyz - czm_viewerPositionWC);

        czm_writeLogDepth(distanceM);
      }
`;


    function createVertexArray(context: any) {
      var geometry = new Geometry({
        attributes: {
          position: new GeometryAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 2,
            values: positions
          }),
          st: new GeometryAttribute({
            componentDatatype: ComponentDatatype.FLOAT,
            componentsPerAttribute: 2,
            values: sts
          })
        },
        primitiveType: PrimitiveType.TRIANGLES
      });

      var vertexArray = VertexArray.fromGeometry({
        context: context,
        geometry: geometry,
        attributeLocations: attributeLocations,
        bufferUsage: BufferUsage.STATIC_DRAW
      });

      return vertexArray;
    };

    function createCommand(context:any) {
      var translucent = false;
      var closed = true;

      var rawRenderState = (Appearance as any).getDefaultRenderState(translucent, closed, undefined);
      var renderState = RenderState.fromCache(rawRenderState);

      var vertexShaderSource = new ShaderSource({
        sources: [vtxfVertexShader]
      });

      var fragmentShaderSource = new ShaderSource({
        sources: [vtxfFragmentShader]
      });

      var uniformMap = {
        udImage: function () {
          if (defined(colourTextureGL)) {
            return colourTextureGL;
          } else {
            return context.defaultTexture;
          }
        },
        udDepth: function () {
          if (defined(udTextureDepth)) {
            return udTextureDepth;
          } else {
            return context.defaultTexture;
          }
        }
      };

      var shaderProgram = ShaderProgram.fromCache({
        context: context,
        vertexShaderSource: vertexShaderSource,
        fragmentShaderSource: fragmentShaderSource,
        attributeLocations: attributeLocations
      });

      return new DrawCommand({
        vertexArray: createVertexArray(context),
        primitiveType: PrimitiveType.TRIANGLES,
        renderState: renderState,
        shaderProgram: shaderProgram,
        uniformMap: uniformMap,
        pass: Pass.OPAQUE
      });
    }

    this.show = true;
    this._command = undefined;
    this._createCommand = createCommand;
  }

  update(frameState: { camera: { viewMatrix: any; frustum: { projectionMatrix: any; }; }; context: any; commandList: any[]; }) {
    if (!this.show) {
      return;
    }

    if (udSDKReady == 2) {
      var thisWidth = viewer.canvas.width;
      var thisHeight = viewer.canvas.height;

      if (thisWidth != this.prevWidth || thisHeight != this.prevHeight) {
        this.prevWidth = thisWidth;
        this.prevHeight = thisHeight;

        udSDKJS_ResizeScene(thisWidth, thisHeight, 0, 0);

        var context = (viewer.scene as any).context;
        colourTextureGL.destroy();
        colourTextureGL = new Texture({
          context: context,
          pixelFormat: PixelFormat.RGBA,
          width: thisWidth,
          height: thisHeight
        });
        udTextureDepth.destroy();
        udTextureDepth = new Texture({
          context: context,
          pixelFormat: PixelFormat.RGBA,
          width: thisWidth,
          height: thisHeight
        });
      }

      var v = frameState.camera.viewMatrix;
      udSDKJS_SetMatrix("view", v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13], v[14], v[15]);

      var v = frameState.camera.frustum.projectionMatrix;
      udSDKJS_SetMatrix("projection", v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13], v[14], v[15]);

      udSDKJS_RenderQueue();

      var ptr = udSDKJS_GetColourBuffer();
      var data = new Uint8Array(HEAPU8.subarray(ptr, ptr + (thisWidth * thisHeight * 4)));

      colourTextureGL.copyFrom({
        source: {
          width: thisWidth,
          height: thisHeight,
          arrayBufferView: data
        }
      });

      var ptr = udSDKJS_GetDepthBuffer();
      var dataHeap = new Uint8Array(HEAPU8.subarray(ptr, ptr + (thisWidth * thisHeight * 4)));

      udTextureDepth.copyFrom({
        source: {
          width: thisWidth,
          height: thisHeight,
          arrayBufferView: dataHeap
        }
      });

      if (!defined(this._command)) {
        (this as any)._command = this._createCommand(frameState.context);
      }

      if (defined(this._command)) {
        frameState.commandList.push(this._command);
      }
    }
  }

  isDestroyed() {
    return false;
  }

  destroy() {
    if (defined(this._command)) {
      (this as any)._command.shaderProgram = (this as any)._command.shaderProgram && (this as any)._command.shaderProgram.destroy();
    }
    return destroyObject(this);
  };
}

// Examples
//  Brisbane:
//    DrawLineTest(Cesium.Cartesian3.fromDegreesArrayHeights([153.0262193, -27.4674781, 40, 153.0289364, -27.4776821, 20]), 0.3); // Hits the first building
//    DrawLineTest(Cesium.Cartesian3.fromDegreesArrayHeights([153.0262193, -27.4674781, 40, 153.0289364, -27.4776821, 20]), 0.01, 130); // Between buildings in the next street
//  Melbourne:
//    DrawLineTest(Cesium.Cartesian3.fromDegreesArrayHeights([144.9325991, -37.8194791, 40, 144.9319378, -37.8193458, 40]), 0.01); // Beam is too narrow and passes through the model
//    DrawLineTest(Cesium.Cartesian3.fromDegreesArrayHeights([144.9325991, -37.8194791, 40, 144.9319378, -37.8193458, 40]), 0.1); // Beam hits the structure as expected
function DrawLineTest(positions: Cartesian3[], rayWidth: any, beginZone = 0) {
  if (lineEntityPartA !== undefined) {
    viewer.entities.remove(lineEntityPartA);
    lineEntityPartA = undefined;
  }

  if (lineEntityPartB !== undefined) {
    viewer.entities.remove(lineEntityPartB);
    lineEntityPartB = undefined;
  }

  if (lineEntityPartC !== undefined) {
    viewer.entities.remove(lineEntityPartC);
    lineEntityPartC = undefined;
  }

  var bufferedStart = Cartesian3.clone(positions[0], new Cartesian3());

  if (beginZone > 0) {
    var delta = Cartesian3.subtract(positions[1], positions[0], new Cartesian3());
    var direction = Cartesian3.normalize(delta, new Cartesian3());
    var length = Cartesian3.magnitude(delta);

    if (length > beginZone) {
      bufferedStart = Cartesian3.add(Cartesian3.multiplyByScalar(direction, beginZone, new Cartesian3()), positions[0], new Cartesian3());

      // Display a yellow line to indicate how much was 'skipped' from the start
      lineEntityPartC = viewer.entities.add({
        polyline: {
          positions: [positions[0], bufferedStart],
          width: 10,
          material: new PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: Color.YELLOW,
          }),
        },
      });
    }
  }

  let distance = udSDKJS_IsPointVisible(bufferedStart, positions[1], rayWidth);

  //The following console log helps to debug to see how far between bufferedStart and positions[1] a point was found
  //console.log("IsVisible:", distance);

  if (distance >= 0.0) { // Was the function successful
    if (distance == 1.0) { // No point was found, the ray reached the goal
      lineEntityPartA = viewer.entities.add({
        polyline: {
          positions: [bufferedStart, positions[1]],
          width: 10,
          material: new PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: Color.CORNFLOWERBLUE,
          }),
        },
      });
    } else if (distance == 0.0) { // A point was found immediately, the ray didn't leave the start
      lineEntityPartB = viewer.entities.add({
        polyline: {
          positions: [bufferedStart, positions[1]],
          width: 10,
          material: new PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: Color.CRIMSON,
          }),
        },
      });
    } else { // The ray reached a point in the middle somewhere
      const midPoint = Cartesian3.lerp(bufferedStart, positions[1], distance, new Cartesian3()); // This calculates that point

      // Draw the blue part from the start (with the buffer: using bufferedStart) until the line meets the obstructions
      lineEntityPartA = viewer.entities.add({
        polyline: {
          positions: [bufferedStart, midPoint],
          width: 10,
          material: new PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: Color.CORNFLOWERBLUE,
          }),
        },
      });

      // Draw the red from from the obstruction to the goal
      lineEntityPartB = viewer.entities.add({
        polyline: {
          positions: [midPoint, positions[1]],
          width: 10,
          material: new PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: Color.CRIMSON,
          }),
        },
      });
    }
  }
}

function loadModels() {
  udSDKJS_LoadModel("https://models.euclideon.com/Aerometrex_Brisbane_75mm.uds").then(
    function (modelid: number) {
      udSDKJS_RenderQueueAddModel(modelid, 112.0, 4978);
    },
    function (error: any) { OnError("Loading Brisbane", error) }
  );

  udSDKJS_LoadModel("https://models.euclideon.com/GoldCoast_20mm.uds").then(
    function (modelid: number) {
      udSDKJS_RenderQueueAddModel(modelid, 140.0, 4978);
    },
    function (error: any) { OnError("Loading GoldCoast", error) }
  );

  udSDKJS_LoadModel("https://models.euclideon.com/Melbourne_75mm.uds").then(
    function (modelid: number) {
      udSDKJS_RenderQueueAddModel(modelid, 150.0, 4978);
    },
    function (error: any) { OnError("Loading Melbourne", error) }
  );

  udSDKJS_LoadModel("https://models.euclideon.com/Vancouver.uds").then(
    function (modelid: number) {
      const slot = udSDKJS_RenderQueueAddModel(modelid, 227.0, 4978);
      if (slot >= 0)
        udSDKJS_RenderQueueItem_SetClassification(slot);
    },
    function (error: any) { OnError("Loading Vancouver", error) }
  );

  var position = Cartesian3.fromDegrees(153.0, -27.0, 0.5);
  viewer.camera.flyToBoundingSphere(new BoundingSphere(position, 100000));

  udSDKReady = 2;
}

function OnError(task: string, code: any) {
  alert(task + " had error: " + udSDKJS_GetErrorString(code) + " (" + code + ")");
}

function udSDKPluginInit() {
  udSDKJS_RegisterShared();
  udSDKReady = 1;

  udSDKJS_CreateFrom_udCloud("CesiumJS Sample").then(
    function () {
      loadModels();
    },
    function (code: any) { OnError("Get Session", code); }
  );
};

@Directive({
  selector: '[appCesiumudsdk]'
})
export class CesiumudsdkDirective implements OnInit {
  constructor(private el: ElementRef) { }

  udSDKPluginInit() {
    udSDKJS_RegisterShared();
    udSDKReady = 1;

    udSDKJS_CreateFrom_udCloud("CesiumJS Sample").then(
      function () {
        loadModels();
      },
      function (code: any) { OnError("Get Session", code); }
    );
  };

  ngOnInit() {
    viewer = new Viewer(this.el.nativeElement, {
      scene3DOnly: true,
      imageryProvider: new UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        credit: new Credit(`© OpenStreetMap contributors`, true),
        maximumLevel: 18,
        enablePickFeatures: false
      }),
      baseLayerPicker: false,
      geocoder: false,
    });
    
    viewer.scene.primitives.add(new VtxfPrimitive());

    globalThis.Module = {
      noInitialRun: true,
      preRun: [],
      onRuntimeInitialized: udSDKPluginInit,
      setStatusLast: { text: '' },
      setStatus: function (text: string) {
        console.log(text);

        if (text === globalThis.Module.setStatusLast.text)
          return;
    
          globalThis.Module.setStatusLast.text = text;
      },

      ccall(ident: string, returnType?: string, argTypes?: string[], args?: any[]): number | void { return; },
      addFunction(callback: Function, signature: string): number { return 0; },
      removeFunction(callbackPtr: number): void { return; },
      _malloc(size: number): number { return 0; },
      _free(ptr: number): void { return; },
    };

    globalThis.Module.setStatus('Downloading...');
    
    let script = document.createElement("script");
    script.src = "assets/euclideon/udSDKjs.js";
    document.body.appendChild(script);
  }
}

