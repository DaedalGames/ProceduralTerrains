import type { NoiseLayer, NoiseStack, GraphDocument, ManualDocument } from './index.js';
export declare function makeLayer(type: string, overrides?: Partial<NoiseLayer>): NoiseLayer;
export declare function makeStack(layers?: NoiseLayer[], options?: Partial<NoiseStack>): NoiseStack;
export declare function defaultLegacyStack(): NoiseStack;
export declare function migrateStack(stack: NoiseStack): NoiseStack;
export declare const NOISE_TYPES: readonly { id: string; label: string; [key: string]: unknown }[];
export interface GraphProgram {
  kind: 'graph';
  sig: string;
  heightSig: string;
  body2d: string;
  body3d: string;
  evaluate2D: (...args: unknown[]) => number;
}
export declare function compileTerrainGraph(document: GraphDocument): {
  ok: boolean;
  diagnostics: { message: string; [key: string]: unknown }[];
  program?: GraphProgram;
};
export declare function normalizeManualTerrainDocument(document: ManualDocument): ManualDocument;
export declare function createBlankGraph(mode?: 'terrain' | 'noise'): GraphDocument;
export declare function makeGraphNode(
  type: string,
  position?: { x: number; y: number },
  overrides?: Partial<GraphDocument['nodes'][number]>,
): GraphDocument['nodes'][number];
