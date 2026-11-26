// The cast antlers of spring (Plan R3-4, huntcode.js sheds: the ones near you, this year, not picked up yet): each lying on
// the ground where its herd beds, the same model for all (animals.js shedModel). At most SHOWN, looked at when the list
// changes.
import { shedModel } from './animals.js';
import { nearX } from '../world/planet.js';

const SHOWN = 6;
export class ShedView {
  constructor(view) { this.view = view; this.pool = []; this.v = -1; }
  update(game, scene) {
    const H = game.huntcode, list = scene === game.world && H ? H.sheds : [], me = game.player;
    if (H && H.shedsV !== this.v) {
      this.v = H.shedsV;
      list.slice(0, SHOWN).forEach((s, i) => {
        const m = this.pool[i] ||= this.make(s.five);
        if (m.userData.five !== s.five) { this.view.scene.remove(m); this.pool[i] = this.make(s.five); }
        const o = this.pool[i];
        o.position.set(s.x, this.view.groundY(scene, s.x, s.y), s.y); o.rotation.y = s.yaw;
      });
    }
    for (let i = 0; i < this.pool.length; i++) {
      const o = this.pool[i], s = list[i];
      o.visible = !!s && i < SHOWN;
      if (s) o.position.x = nearX(s.x, me?.x ?? s.x);
    }
  }
  make(five) {
    const m = shedModel(five);
    m.userData.five = five;
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.view.scene.add(m);
    return m;
  }
}
