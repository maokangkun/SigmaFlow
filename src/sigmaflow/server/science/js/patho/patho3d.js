/* ================= 虚拟病原体 · 3D 形态视图(P6, THREE 重制版) =================
 * 程序化精细建模: 每大类按形态学特征构建真实几何体 ——
 *   病毒: 半透包膜 + 正二十面体衣壳 + 三聚体刺突(斐波那契球面分布) + 螺旋核衣壳
 *   细菌: 荚膜杆体(Capsule) + 类核 + 周生鞭毛(螺旋管, 行波摆动) + 菌毛/芽孢
 *   真菌: 酵母出芽(芽痕环) / 丝状菌分枝菌丝 + 顶端孢子链
 *   原虫: 噪声位移不规则体 + 纤毛场(实例化摆动) + 鞭毛
 *   蠕虫: 分节链(正弦游行) + 头节小钩
 *   朊粒: 双股交织淀粉样纤维束(缓慢扭转)
 * 渲染: cell3d.min 内核(THREE + OrbitControls + RoomEnvironment), PBR 材质
 * (clearcoat 湿润质感 / transmission 半透包膜荚膜), ACES 色调映射。
 * 铁律之下的诚实: 教学示意, 程序化建模, 非真实结构 —— 标注永远写明。
 */
(() => {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  const PALETTE = {
    virus: ['#d05a76', '#a8485f'], bacterium: ['#3f9e8f', '#2f7a6e'], fungus: ['#c9a15a', '#a07c3e'],
    protozoa: ['#6d84c9', '#5268a8'], protozoan: ['#6d84c9', '#5268a8'], worm: ['#b08560', '#8a6544'], helminth: ['#b08560', '#8a6544'], prion: ['#9a7ab5', '#755a90'],
  };
  let S = null;   // {THREE, entry, renderer, scene, camera, controls, raf, anim, el}

  // ---------- 几何助手 ----------
  const fibSphere = (n, r) => {
    const pts = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const rad = Math.sqrt(1 - y * y);
      const th = ga * i;
      pts.push([Math.cos(th) * rad * r, y * r, Math.sin(th) * rad * r]);
    }
    return pts;
  };
  const helixPts = (turns, r, len, phase = 0, wob = 0) => {
    const pts = [];
    const n = Math.max(24, turns * 14);
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = t * turns * Math.PI * 2 + phase;
      pts.push([Math.cos(a) * r + Math.sin(t * 9) * wob, (t - 0.5) * len, Math.sin(a) * r + Math.cos(t * 7) * wob]);
    }
    return pts;
  };
  const rand = (seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647))(20260101);

  function buildVirus(THREE, entry, M) {
    const [c1, c2] = M.col;
    const g = new THREE.Group();
    // 半透包膜: transmission 出湿润双层脂质感
    const env = new THREE.Mesh(
      new THREE.SphereGeometry(60, 48, 32),
      M.mat(c1, { transmission: 0.5, roughness: 0.14, thickness: 26, clearcoat: 1, clearcoatRoughness: 0.12 })
    );
    g.add(env);
    // 正二十面体衣壳(flat 着色出多面体感)
    const capsid = new THREE.Mesh(
      new THREE.IcosahedronGeometry(40, 1),
      M.mat('#e6d3da', { flat: true, roughness: 0.4, clearcoat: 0.5, transmission: 0.12 })
    );
    g.add(capsid);
    // 螺旋核衣壳(管几何)
    const ncCurve = new THREE.CatmullRomCurve3(helixPts(4.5, 15, 54).map(p => new THREE.Vector3(...p)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(ncCurve, 96, 3.4, 10, false), M.mat('#f0e3ea', { roughness: 0.5, clearcoat: 0.3 })));
    // 刺突: 斐波那契分布的茎+三聚体头(几何与材质都循环外共享 —— 38 个刺突
    // ×4 部件各自 new 材质是纯浪费, 共享后 draw call 与内存都省)
    const stemG = new THREE.CylinderGeometry(1.6, 2.4, 13, 8);
    const headG = new THREE.SphereGeometry(4.4, 14, 10);
    const stemMat = M.mat(c2, { roughness: 0.35, clearcoat: 0.8 });
    const headMat = M.mat(c2, { roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.2 });
    const subMat = M.mat(c2, { roughness: 0.3, clearcoat: 0.9 });
    const up = new THREE.Vector3(0, 1, 0);
    let spikes = 0;
    for (const [x, y, z] of fibSphere(38, 60)) {
      const dir = new THREE.Vector3(x, y, z).normalize();
      const grp = new THREE.Group();
      const stem = new THREE.Mesh(stemG, stemMat);
      stem.position.y = 6.5;
      grp.add(stem);
      const head = new THREE.Mesh(headG, headMat);
      head.position.y = 13.5;
      head.scale.set(1.25, 0.85, 1.25);
      grp.add(head);
      for (let k = 0; k < 2; k++) {   // 三聚体侧亚基
        const sub = new THREE.Mesh(headG, subMat);
        sub.scale.setScalar(0.62);
        const a = k * Math.PI;
        sub.position.set(Math.cos(a) * 4.6, 12.6, Math.sin(a) * 4.6);
        grp.add(sub);
      }
      grp.position.set(x, y, z);
      grp.quaternion.setFromUnitVectors(up, dir);
      g.add(grp);
      spikes++;
    }
    return {
      group: g, spikes,
      caption: '包膜病毒: 三聚体刺突(斐波那契分布) + 正二十面体衣壳 + 螺旋核衣壳',
      animate: null,
    };
  }

  function buildBacterium(THREE, entry, M) {
    const [c1, c2] = M.col;
    const g = new THREE.Group();
    const rod = !/cocci|staph|strep|球菌|链/i.test(entry.zh + entry.id);
    if (rod) {
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(26, 56, 12, 28),
        M.mat(c1, { roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.25, sheen: 0.4 })
      );
      body.rotation.z = Math.PI / 2;
      g.add(body);
      // 荚膜: 放大的半透壳
      const cap = new THREE.Mesh(
        new THREE.CapsuleGeometry(31, 64, 10, 22),
        M.mat(c2, { transmission: 0.72, roughness: 0.4, thickness: 12, opacity: 0.9 })
      );
      cap.rotation.z = Math.PI / 2;
      g.add(cap);
      // 类核(半透内体)
      const nuc = new THREE.Mesh(
        new THREE.SphereGeometry(19, 24, 18),
        M.mat('#dce8e2', { transmission: 0.6, roughness: 0.6 })
      );
      nuc.scale.set(1.7, 0.75, 0.85);
      g.add(nuc);
      // 周生鞭毛: 锚在两端/体的螺旋管, 行波摆动(绕锚轴微旋)
      const flagella = [];
      for (let f = 0; f < 5; f++) {
        const anchor = [[-52, 0, 0], [52, 0, 0], [-30, 18, 8], [30, -16, -10], [0, 24, -6]][f];
        const dir = new THREE.Vector3(anchor[0], anchor[1], anchor[2]).normalize();
        const pts = helixPts(6, 5.5, 62, f * 1.3, 2).map(p => new THREE.Vector3(...p));
        const mesh = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 110, 1.0, 6, false),
          M.mat(c2, { roughness: 0.5, clearcoat: 0.4 })
        );
        const grp = new THREE.Group();
        grp.position.set(...anchor);
        grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        grp.add(mesh);
        g.add(grp);
        flagella.push({ grp, phase: f * 1.7, axis: dir });
      }
      // 菌毛(细短, 材质共享)
      const pilusMat = M.mat(c2, { roughness: 0.6 });
      const pilus = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 13, 5), pilusMat);
      for (let i = 0; i < 14; i++) {
        const m = pilus.clone();
        const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
        const p = dir.clone().multiplyScalar(27);
        m.position.copy(p);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        g.add(m);
      }
      let cap2 = '荚膜杆菌: 周生鞭毛(行波) + 菌毛 + 类核';
      if (/芽孢|anthr|梭|clostrid/i.test(entry.zh + entry.id)) {
        const spore = new THREE.Mesh(
          new THREE.SphereGeometry(17, 26, 20),
          M.mat('#d8c9a0', { roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1 })
        );
        spore.scale.set(1.35, 1, 1);
        spore.position.set(18, 4, 0);
        g.add(spore);
        cap2 = '芽孢杆菌: 内生芽孢(高光硬壁) + 鞭毛 + 荚膜';
      }
      return {
        group: g, spikes: flagella.length,
        caption: cap2,
        animate: (t, three) => {
          for (const f of flagella) {
            f.grp.rotateOnAxis(f.axis.clone().cross(new THREE.Vector3(0, 0, 1)).normalize(), 0);
            f.grp.rotation.x = Math.sin(t * 3.2 + f.phase) * 0.28;
            f.grp.rotation.z = Math.cos(t * 2.6 + f.phase) * 0.22;
          }
        },
      };
    }
    // 球菌: 四联/簇
    const seeds = [[-24, -14, 0], [24, -14, 0], [-24, 16, 4], [24, 16, -4], [0, 1, -22]];
    for (const [x, y, z] of seeds) {
      const c = new THREE.Mesh(
        new THREE.SphereGeometry(23, 36, 26),
        M.mat(c1, { roughness: 0.3, clearcoat: 0.95, clearcoatRoughness: 0.2 })
      );
      c.position.set(x, y, z);
      g.add(c);
    }
    const pilusMat = M.mat(c2, { roughness: 0.6 });
    const pilus = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 12, 5), pilusMat);
    for (let i = 0; i < 16; i++) {
      const m = pilus.clone();
      const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      m.position.copy(dir.clone().multiplyScalar(48));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(m);
    }
    return { group: g, spikes: 16, caption: '球菌簇: 荚膜多糖 + 菌毛', animate: null };
  }

  function buildFungus(THREE, entry, M) {
    const [c1, c2] = M.col;
    const g = new THREE.Group();
    if (/丝|霉|mold|菌丝/i.test(entry.id + entry.zh)) {
      // 分枝菌丝: 递归管
      const branch = (pos, dir, len, depth) => {
        const end = pos.clone().add(dir.clone().multiplyScalar(len));
        const mid = pos.clone().add(dir.clone().multiplyScalar(len * 0.5))
          .add(new THREE.Vector3(rand() - 0.5, rand() * 0.4, rand() - 0.5).multiplyScalar(14));
        const curve = new THREE.CatmullRomCurve3([pos, mid, end]);
        const tube = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 24, depth * 1.6 + 1.6, 8, false),
          M.mat(c1, { roughness: 0.45, clearcoat: 0.55 })
        );
        g.add(tube);
        if (depth > 0) {
          const n = rand() > 0.5 ? 2 : 1;
          for (let i = 0; i < n; i++) {
            const nd = dir.clone()
              .add(new THREE.Vector3(rand() - 0.5, rand() * 0.25, rand() - 0.5).multiplyScalar(0.9))
              .normalize();
            branch(end, nd, len * 0.68, depth - 1);
          }
        } else {
          // 顶端孢子链
          for (let k = 1; k <= 4; k++) {
            const sp = new THREE.Mesh(
              new THREE.SphereGeometry(4.6 - k * 0.5, 16, 12),
              M.mat(c2, { roughness: 0.35, clearcoat: 0.85 })
            );
            sp.position.copy(end).add(dir.clone().multiplyScalar(k * 7.5));
            g.add(sp);
          }
        }
      };
      for (const dx of [-34, 0, 34]) {
        branch(new THREE.Vector3(dx, -78, 0), new THREE.Vector3(rand() * 0.5 - 0.25, 1, rand() * 0.5 - 0.25).normalize(), 42, 3);
      }
      return { group: g, spikes: 27, caption: '丝状真菌: 分枝菌丝(递归管几何) + 顶端孢子链', animate: null };
    }
    // 酵母: 出芽 + 芽痕
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(56, 44, 34),
      M.mat(c1, { roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.18, sheen: 0.5 })
    );
    body.scale.set(1, 1.18, 0.94);
    g.add(body);
    const buds = [[52, 30, 12, 24, 0.6], [-46, 36, -8, 19, 0.35], [8, -52, 16, 15, 0.15]];
    for (const [x, y, z, r, gr] of buds) {
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(r, 30, 22),
        M.mat(c1, { roughness: 0.28, clearcoat: 0.95, clearcoatRoughness: 0.2 })
      );
      b.position.set(x, y, z);
      b.scale.setScalar(0.7 + gr * 0.3);
      g.add(b);
      // 芽痕环
      const scar = new THREE.Mesh(
        new THREE.TorusGeometry(r * 0.55, 1.6, 8, 22),
        M.mat(c2, { roughness: 0.4, clearcoat: 0.6 })
      );
      const nrm = new THREE.Vector3(x, y, z).normalize();
      scar.position.copy(nrm.clone().multiplyScalar(54));
      scar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
      g.add(scar);
    }
    return { group: g, spikes: 27, caption: '酵母: 出芽繁殖 + 芽痕环(出芽位点)', animate: null };
  }

  function buildProtozoa(THREE, entry, M) {
    const [c1, c2] = M.col;
    const g = new THREE.Group();
    // 噪声位移不规则体
    const geo = new THREE.SphereGeometry(46, 96, 64);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = Math.sin(v.x * 0.14) * Math.cos(v.y * 0.11) * Math.sin(v.z * 0.09 + 2);
      const n2 = Math.sin(v.x * 0.31 + 5) * Math.sin(v.z * 0.27);
      v.multiplyScalar(1 + n * 0.1 + n2 * 0.045);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, M.mat(c1, { roughness: 0.3, clearcoat: 0.8, sheen: 0.35 })));
    // 纤毛场: 实例化 + 摆动
    const cilG = new THREE.CylinderGeometry(0.5, 0.5, 9, 4);
    cilG.translate(0, 4.5, 0);
    const cilM = M.mat(c2, { roughness: 0.6 });
    const N = 110;
    const inst = new THREE.InstancedMesh(cilG, cilM, N);
    const cils = [];
    fibSphere(N, 46).forEach(([x, y, z], i) => {
      const dir = new THREE.Vector3(x, y, z).normalize();
      cils.push({ dir, pos: new THREE.Vector3(x, y, z), phase: rand() * 6.28 });
    });
    g.add(inst);
    // 鞭毛 3 条
    const flagella = [];
    for (let f = 0; f < 3; f++) {
      const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      const pts = helixPts(5, 5, 54, f * 2.1, 2.5).map(p => new THREE.Vector3(...p));
      const grp = new THREE.Group();
      grp.position.copy(dir.clone().multiplyScalar(44));
      grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      grp.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.9, 6, false), M.mat(c2, { roughness: 0.5 })));
      g.add(grp);
      flagella.push({ grp, phase: f * 1.9 });
    }
    const dummy = new THREE.Object3D();
    const axis = new THREE.Vector3();
    return {
      group: g, spikes: N,
      caption: '原虫: 噪声位移不规则体 + 纤毛场(实例化) + 鞭毛',
      animate: (t, three) => {
        for (let i = 0; i < N; i++) {
          const c = cils[i];
          dummy.position.copy(c.pos);
          axis.set(c.dir.z, 0, -c.dir.x).normalize();
          dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.dir);
          dummy.rotateOnAxis(axis, Math.sin(t * 7 + c.phase) * 0.5);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        }
        inst.instanceMatrix.needsUpdate = true;
        for (const f of flagella) {
          f.grp.rotation.x = Math.sin(t * 3.4 + f.phase) * 0.3;
          f.grp.rotation.z = Math.cos(t * 2.8 + f.phase) * 0.24;
        }
      },
    };
  }

  function buildWorm(THREE, entry, M) {
    const [c1, c2] = M.col;
    const g = new THREE.Group();
    const segs = [];
    const NSEG = 15;
    const path = tt => {
      const pts = [];
      for (let i = 0; i <= NSEG; i++) {
        const t = i / NSEG;
        const ph = t * Math.PI * 2.4 + tt;
        pts.push(new THREE.Vector3((t - 0.5) * 190, Math.sin(ph) * 26, Math.cos(t * 3.4 + tt * 0.6) * 14));
      }
      return pts;
    };
    for (let i = 0; i < NSEG; i++) {
      const r = 27 - Math.abs(i - (NSEG - 2)) * 1.7;
      const seg = new THREE.Mesh(
        new THREE.SphereGeometry(r, 30, 22),
        M.mat(i % 3 === 0 ? c2 : c1, { roughness: 0.34, clearcoat: 0.85, clearcoatRoughness: 0.22, sheen: 0.3 })
      );
      seg.scale.set(1.35, 0.85, 0.6);
      g.add(seg);
      segs.push(seg);
    }
    // 头节 + 小钩
    const scolex = new THREE.Mesh(new THREE.SphereGeometry(16, 26, 20), M.mat(c2, { roughness: 0.3, clearcoat: 0.9 }));
    const hooks = new THREE.ConeGeometry(1.7, 6, 6);
    const hookMat = M.mat('#e8e0c8', { roughness: 0.25, metalness: 0.4 });
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < 8; i++) {
        const h = new THREE.Mesh(hooks, hookMat);
        const a = (i / 8) * Math.PI * 2 + ring * 0.39;
        h.position.set(-99, Math.sin(a) * (12 - ring * 4), Math.cos(a) * (12 - ring * 4) * 0.7);
        h.rotation.z = Math.PI / 2;
        g.add(h);
      }
    }
    g.add(scolex);
    return {
      group: g, spikes: NSEG,
      caption: '绦虫样蠕虫: 分节链(正弦游行) + 头节小钩环',
      animate: t => {
        const pts = path(t * 0.9);
        scolex.position.copy(pts[0]);
        segs.forEach((sg, i) => sg.position.copy(pts[i + 1]));
      },
    };
  }

  function buildPrion(THREE, entry, M) {
    const [c1, c2] = M.col;
    const g = new THREE.Group();
    const bundles = [];
    for (const dx of [-36, 0, 36]) {
      const grp = new THREE.Group();
      // 双股交织: 两条相位差 π 的螺旋管
      for (let s = 0; s < 2; s++) {
        const pts = helixPts(7, 7.5, 116, s * Math.PI, 1.2).map(p => new THREE.Vector3(...p));
        grp.add(new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 140, 4.2, 8, false),
          M.mat(s ? c2 : c1, { roughness: 0.38, clearcoat: 0.7, sheen: 0.4 })
        ));
      }
      // 缀连的单体(错误折叠, 材质共享)
      const mono1 = M.mat(c1, { roughness: 0.42, clearcoat: 0.6 });
      const mono2 = M.mat(c2, { roughness: 0.42, clearcoat: 0.6 });
      for (let i = 0; i < 9; i++) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(4.2, 12, 9),
          i % 3 === 0 ? mono2 : mono1
        );
        const a = rand() * 6.28;
        m.position.set(dx * 0 + Math.cos(a) * (11 + rand() * 9), (rand() - 0.5) * 108, Math.sin(a) * (11 + rand() * 9));
        grp.add(m);
      }
      grp.position.x = dx;
      g.add(grp);
      bundles.push({ grp, phase: dx });
    }
    return {
      group: g, spikes: 42,
      caption: '朊粒: 双股交织 β-折叠淀粉样纤维束 + 游离错误折叠单体',
      animate: t => { for (const b of bundles) b.grp.rotation.y = Math.sin(t * 0.5 + b.phase) * 0.35; },
    };
  }

  // ---------- 渲染主体 ----------
  function render() {
    const s = S;
    if (!s) return;
    const tt = (performance.now() - s.t0) / 1000;
    if (s.anim) { try { s.anim(tt, s.THREE); } catch {} }
    s.controls.update();
    s.renderer.render(s.scene, s.camera);
    s.raf = requestAnimationFrame(render);
  }

  function buildScene(entry) {
    const s = S;
    const { THREE } = s;
    const CV = G.CellViewer;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#10131c');
    // 环境光照(PBR 反射源) + 主光/轮廓光
    const pmrem = new THREE.PMREMGenerator(s.renderer);
    const envTex = pmrem.fromScene(new CV.RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    // 环境纹理与生成器随会话保存: close 时显式释放(traverse 只覆盖场景子对象,
    // 不含 environment 贴图 —— 反复开关形态视图会累积泄漏 GPU 显存)
    s._pmrem = pmrem;
    s._envTex = envTex;
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(120, 160, 180);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.9);
    rim.position.set(-160, -60, -140);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    const M = {
      col: PALETTE[entry.kind] || PALETTE.virus,
      mat: (hex, o = {}) => {
        const m = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(hex),
          roughness: o.roughness ?? 0.4,
          metalness: o.metalness ?? 0,
          clearcoat: o.clearcoat ?? 0,
          clearcoatRoughness: o.clearcoatRoughness ?? 0.2,
          sheen: o.sheen ?? 0,
          flatShading: !!o.flat,
          side: THREE.DoubleSide,
        });
        if (o.transmission) {
          m.transmission = o.transmission;
          m.thickness = o.thickness ?? 10;
          m.ior = 1.33;
          m.transparent = true;
        }
        return m;
      },
    };
    const builders = {
      virus: buildVirus, bacterium: buildBacterium, fungus: buildFungus,
      protozoa: buildProtozoa, protozoan: buildProtozoa,
      helminth: buildWorm, worm: buildWorm, prion: buildPrion,
    };
    const built = (builders[entry.kind] || buildVirus)(THREE, entry, M);
    // 自适应取景: 包围盒
    const box3 = new THREE.Box3().setFromObject(built.group);
    const size = box3.getSize(new THREE.Vector3()).length();
    const center = box3.getCenter(new THREE.Vector3());
    built.group.position.sub(center);
    scene.add(built.group);

    const W = 620, H = 460;   // 与 renderer.setSize 一致(stage 定尺寸)
    const camera = new THREE.PerspectiveCamera(40, W / H, 1, 2000);
    camera.position.set(0, size * 0.22, size * 1.05);
    camera.lookAt(0, 0, 0);
    const controls = new CV.OrbitControls(camera, s.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.4;
    controls.minDistance = size * 0.5;
    controls.maxDistance = size * 2.6;

    Object.assign(s, { scene, camera, controls, anim: built.animate });
    if (s.el.cap) {
      s.el.cap.textContent = `${entry.zh}(${entry.id}) · ${built.caption} · tier ${entry.tier} —— 程序化示意形态, 非真实结构`;
    }
    s.t0 = performance.now();
    render();
  }

  function close() {
    if (!S) return;
    if (S.raf) cancelAnimationFrame(S.raf);
    try { S.controls && S.controls.dispose(); } catch {}
    try { S.renderer && S.renderer.dispose(); } catch {}
    try { S._envTex && S._envTex.dispose(); } catch {}
    try { S._pmrem && S._pmrem.dispose(); } catch {}
    try {
      if (S.scene) S.scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
    } catch {}
    if (S.el.box && S.el.box.parentNode) S.el.box.parentNode.removeChild(S.el.box);
    S = null;
  }

  function open(entryId) {
    const C = G.PathoCatalog;
    const id = entryId || (G.PathoHost && G.PathoHost.state() && G.PathoHost.state().entry.id);
    const entry = C && C.get(id);
    if (!C || !entry) { if (G.CS && G.CS.toast) G.CS.toast('先选择病原体', 'error'); return; }
    close();
    const box = document.createElement('div');
    box.id = 'patho3d';
    box.innerHTML = `
      <div class="p23d-card">
        <div class="p23d-head"><b>🦠 形态视图</b><button type="button" class="pai-x" id="p23dClose">✕</button></div>
        <div class="p23d-stage" id="p23dStage"><div class="p23d-loading small">正在加载 3D 内核与模型…</div></div>
        <div class="p23d-hint">拖拽旋转 · 滚轮缩放 · 自动自转</div>
        <div class="p23d-cap" id="p23dCap"></div>
      </div>`;
    (document.getElementById('pathogen-root') || document.body).appendChild(box);
    S = { t0: 0, raf: 0, entry, anim: null, el: { box, cv: null, cap: box.querySelector('#p23dCap') } };
    box.querySelector('#p23dClose').addEventListener('click', close);
    box.addEventListener('mousedown', e => e.stopPropagation());   // 不惊动页面级拖拽
    const stage = box.querySelector('#p23dStage');
    // 按需拉 3D 内核(cell3d.min: THREE/OrbitControls/RoomEnvironment)
    G.CS.ensureLazy('cell3d.min').then(() => {
      if (!S || S.el.box !== box) return;   // 已被关闭/重开
      if (!G.CellViewer) {
        stage.innerHTML = '<div class="p23d-loading small">3D 内核不可用(站点构建产物缺失)。</div>';
        return;
      }
      const THREE = G.CellViewer.THREE;
      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      } catch (e) {
        stage.innerHTML = '<div class="p23d-loading small">当前环境不支持 WebGL, 无法渲染 3D 形态。</div>';
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(620, 460);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.className = 'p23d-cv';
      stage.innerHTML = '';
      stage.appendChild(renderer.domElement);
      S.THREE = THREE;
      S.renderer = renderer;
      try {
        buildScene(entry);
      } catch (e) {
        stage.insertAdjacentHTML('beforeend', `<div class="p23d-loading small">建模失败: ${String(e && e.message || e).slice(0, 120)}</div>`);
      }
    });
  }

  G.Patho3D = { open, close, state: () => S };
  G.openPatho3D = () => G.Patho3D.open();
})();
