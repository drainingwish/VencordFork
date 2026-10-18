export interface AnimationEngine {
    validatePack(text: string): string | null;
    start(): void;
    stop(): void;
    getSettingsPanel(): import("react").ReactNode;
}
export default function createEngine(api: unknown, bridge: unknown): AnimationEngine;
