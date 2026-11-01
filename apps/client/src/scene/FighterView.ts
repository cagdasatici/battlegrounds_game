/** Original geometric placeholder fighter: capsule body plus a box visor showing facing. Presentation only. */
import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import type { KitId } from "@eb/shared/protocol";

export const KIT_COLORS: Readonly<Record<KitId, number>> = { sv: 0xd8a032, td: 0x2f6fd0, ea: 0x3aa860 };
export const FIGHTER = { radius: 0.35, bodyLength: 1.1 } as const; // total height 1.8 m

export class FighterView {
  readonly group = new Group();
  actionText = "idle";
  private readonly parts: Mesh[] = [];
  private disposed = false;

  constructor(readonly kitId: KitId) {
    const body = new Mesh(new CapsuleGeometry(FIGHTER.radius, FIGHTER.bodyLength, 4, 12), new MeshStandardMaterial({ color: KIT_COLORS[kitId] }));
    const visor = new Mesh(new BoxGeometry(0.4, 0.15, 0.2), new MeshStandardMaterial({ color: 0x202020 }));
    visor.position.set(0, 0.5, -FIGHTER.radius); // yaw 0 faces -Z
    this.group.add(body, visor);
    this.parts.push(body, visor);
  }

  setPose(x: number, y: number, z: number, yaw: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
  }

  setAction(text: string): void { this.actionText = text; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.parts) {
      m.geometry.dispose();
      (m.material as MeshStandardMaterial).dispose();
    }
    this.group.removeFromParent();
    this.group.clear();
  }
}
