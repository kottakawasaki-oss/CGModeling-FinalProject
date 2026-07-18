import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as CANNON from 'cannon-es';

// 1つのリングの情報
interface ParticleGroup {
    points: THREE.Points;
    bodies: CANNON.Body[];
    torus: THREE.TorusGeometry;
    ringRadius: number;
    light: THREE.PointLight;
}

// 花火1発分(3つのリングをまとめたもの)
interface Firework {
    groups: ParticleGroup[];
    exploded: boolean;
    explodeHeight: number;
}

class ThreeJSContainer {
    private scene!: THREE.Scene;
    private light!: THREE.Light;
    private fireworks: Firework[] = [];

    constructor() {

    }

    // 画面部分の作成(表示する枠ごとに)*
    public createRendererDOM = (width: number, height: number, cameraPos: THREE.Vector3) => {
        const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
        renderer.setSize(width, height);
        renderer.setClearColor(new THREE.Color(0x111111));
        renderer.shadowMap.enabled = true; //シャドウマップを有効にする
        renderer.autoClear = false;

        //カメラの設定
        const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        camera.position.copy(cameraPos);
        camera.lookAt(new THREE.Vector3(0, 5, 0));

        const orbitControls = new OrbitControls(camera, renderer.domElement);

        const fadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const fadeScene = new THREE.Scene();
        const fadeMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.3,
            depthTest: false,
            depthWrite: false
        });
        const fadePlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMaterial);
        fadeScene.add(fadePlane);

        this.createScene();
        // 毎フレームのupdateを呼んで，render
        // reqestAnimationFrame により次フレームを呼ぶ
        const render: FrameRequestCallback = (_time) => {
            orbitControls.update();

            renderer.clearDepth();
            renderer.render(fadeScene, fadeCamera);
            renderer.render(this.scene, camera);

            requestAnimationFrame(render);
        }
        requestAnimationFrame(render);

        renderer.domElement.style.cssFloat = "left";
        renderer.domElement.style.margin = "10px";
        return renderer.domElement;
    }

    // シーンの作成(全体で1回)
    private createScene = () => {
        this.scene = new THREE.Scene();

        // 物理演算設定
        const gravity = -3.5;
        const world = new CANNON.World({ gravity: new CANNON.Vec3(0, gravity, 0) });
        world.allowSleep = true;
        world.defaultContactMaterial.friction = 3;
        world.defaultContactMaterial.restitution = 0.009;
        const COLLISION_GROUP_GROUND = 1;
        const COLLISION_GROUP_PARTICLE = 2;

        const particleNum = 16;
        const launchSpeed = 14;  // 打ち上げ速度
        const explodeSpeed = 6;  // 爆発時の飛び散るスピード
        const maxFireworks = 10; // 同時に存在できる花火の最大数

        const generateSprite = (r: number, g: number, b: number) => {
            //新しいキャンバスの作成
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;

            //円形のグラデーションの作成
            const context = canvas.getContext('2d')!;
            const gradient = context.createRadialGradient(canvas.width / 2, canvas.height / 2, 0, canvas.width / 2, canvas.height / 2, canvas.width / 2);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(0.1, `rgba(${r}, ${g}, ${b}, 1)`);
            gradient.addColorStop(0.4, `rgba(${Math.floor(r / 3)}, ${Math.floor(g / 3)}, ${Math.floor(b / 3)}, 1)`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');

            context.fillStyle = gradient;
            context.fillRect(0, 0, canvas.width, canvas.height);
            //テクスチャの生成
            const texture = new THREE.Texture(canvas);
            texture.needsUpdate = true;
            return texture;
        }

        const createParticles = (r: number, g: number, b: number, ringRadius: number, launchX: number, launchZ: number): ParticleGroup => {
            const particleSize = 0.3;
            //ジオメトリ
            const geometry = new THREE.BufferGeometry();
            //マテリアル
            const material = new THREE.PointsMaterial({
                color: 0xffffff,
                size: particleSize,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                map: generateSprite(r, g, b)
            });

            const positions = new Float32Array(particleNum * 3);
            const bodies: CANNON.Body[] = [];
            const particleShape = new CANNON.Sphere(particleSize);

            for (let i = 0; i < particleNum; i++) {
                const startX = launchX;
                const startY = 0.1;
                const startZ = launchZ;

                positions[i * 3] = startX;
                positions[i * 3 + 1] = startY;
                positions[i * 3 + 2] = startZ;

                const particleBody = new CANNON.Body({ mass: 1 });
                particleBody.addShape(particleShape);
                particleBody.position.set(startX, startY, startZ);

                particleBody.velocity.set(0, launchSpeed, 0);
                particleBody.collisionFilterGroup = COLLISION_GROUP_PARTICLE;
                particleBody.collisionFilterMask = COLLISION_GROUP_GROUND; // 地面とだけ衝突

                particleBody.allowSleep = true;
                particleBody.sleepSpeedLimit = 0.5; // この速度を下回ったらスリープ開始
                particleBody.sleepTimeLimit = 0.3;   // この秒数スリープ条件を満たし続けたら停止

                world.addBody(particleBody);
                bodies.push(particleBody);
            }
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            // THREE.Points
            const points = new THREE.Points(geometry, material);

            //シーンへ追加
            this.scene.add(points);

            const torus = new THREE.TorusGeometry(1, ringRadius, 1, particleNum);

            const light = new THREE.PointLight(new THREE.Color(r / 255, g / 255, b / 255), 0, 25, 2);
            light.position.set(launchX, 0, launchZ);
            this.scene.add(light);

            return { points, bodies, torus, ringRadius, light };
        }

        // 花火を爆発させる
        const explodeGroup = (group: ParticleGroup) => {
            const torusPos = group.torus.getAttribute('position');
            const speed = explodeSpeed * group.ringRadius;

            for (let i = 0; i < particleNum; i++) {
                const index = i % torusPos.count;
                const dir = new THREE.Vector3(
                    torusPos.getX(index),
                    torusPos.getY(index),
                    torusPos.getZ(index)
                ).normalize();

                group.bodies[i].velocity.set(
                    dir.x * speed,
                    dir.y * speed + launchSpeed * 0.2,
                    dir.z * speed
                );
            }
        }

        const createFirework = () => {
            const r = Math.random() / 2 + 0.2;
            const launchX = Math.random() * 32 - 16;
            const launchZ = Math.random() * 16 - 24;
            const explodeHeight = Math.random() * 4 + 8;

            const group1 = createParticles(Math.round(Math.random() * 255), Math.round(Math.random() * 255), Math.round(Math.random() * 255), r, launchX, launchZ);
            const group2 = createParticles(Math.round(Math.random() * 255), Math.round(Math.random() * 255), Math.round(Math.random() * 255), r * 0.7, launchX, launchZ);
            const group3 = createParticles(Math.round(Math.random() * 255), Math.round(Math.random() * 255), Math.round(Math.random() * 255), r * 0.5, launchX, launchZ);

            this.fireworks.push({ groups: [group1, group2, group3], exploded: false, explodeHeight });

            // 上限を超えたら一番古い花火を削除
            if (this.fireworks.length > maxFireworks) {
                const old = this.fireworks.shift();
                if (old) removeFirework(old);
            }
        }

        const removeFirework = (fw: Firework) => {
            for (const group of fw.groups) {
                this.scene.remove(group.points);
                this.scene.remove(group.light);
                group.points.geometry.dispose();
                (group.points.material as THREE.Material).dispose();
                for (const body of group.bodies) {
                    world.removeBody(body);
                }
            }
        }

        document.addEventListener('keydown', (event) => {
            switch (event.key) {
                case ' ':
                    createFirework();
                    break;
            }
        });

        const createStall = (x: number, z: number, facing: number = 1, color: THREE.Color) => {
            const addBoxBody = (size: THREE.Vector3, position: THREE.Vector3) => {
                const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
                const body = new CANNON.Body({ mass: 0 });
                body.addShape(shape);
                body.position.set(position.x, position.y, position.z);
                body.collisionFilterGroup = COLLISION_GROUP_GROUND;
                body.collisionFilterMask = COLLISION_GROUP_PARTICLE;
                world.addBody(body);
                return body;
            }

            const roofSize = new THREE.Vector3(2, 0.4, 1.6);
            const roofGeometry = new THREE.BoxGeometry(roofSize.x, roofSize.y, roofSize.z);
            const roofMaterial = new THREE.MeshLambertMaterial({ color });
            const roof = new THREE.Mesh(roofGeometry, roofMaterial);
            roof.position.x = x;
            roof.position.y = 1;
            roof.position.z = z;
            this.scene.add(roof);
            addBoxBody(roofSize, roof.position);

            const counterSize = new THREE.Vector3(2, 0.4, 0.8);
            const counterGeometry = new THREE.BoxGeometry(counterSize.x, counterSize.y, counterSize.z);
            const counterMaterial = new THREE.MeshLambertMaterial({ color: 0xff6666 });
            const counter = new THREE.Mesh(counterGeometry, counterMaterial);
            counter.position.x = x;
            counter.position.y = counterSize.y / 2;
            counter.position.z = z + facing * (roofSize.z / 2 - counterSize.z / 2);
            this.scene.add(counter);
            addBoxBody(counterSize, counter.position);

            const pillarSize = new THREE.Vector3(0.1, 0.8, 0.1);
            const pillarGeometry1 = new THREE.BoxGeometry(pillarSize.x, pillarSize.y, pillarSize.z);
            const pillarMaterial = new THREE.MeshLambertMaterial({ color: 0xa0522d });
            const pillar1 = new THREE.Mesh(pillarGeometry1, pillarMaterial);
            pillar1.position.x = x - roofSize.x / 2 + pillarSize.x / 2;
            pillar1.position.y = 0.4;
            pillar1.position.z = z + facing * (-0.8 + pillarSize.z / 2);
            this.scene.add(pillar1);
            addBoxBody(pillarSize, pillar1.position);

            const pillar2 = new THREE.Mesh(pillarGeometry1, pillarMaterial);
            pillar2.position.x = x + roofSize.x / 2 - pillarSize.x / 2;
            pillar2.position.y = 0.4;
            pillar2.position.z = z + facing * (-roofSize.z / 2 + pillarSize.z / 2);
            this.scene.add(pillar2);
            addBoxBody(pillarSize, pillar2.position);

            const pillarGeometry2 = new THREE.BoxGeometry(pillarSize.x, pillarSize.y - counterSize.y, pillarSize.z);
            const pillar3 = new THREE.Mesh(pillarGeometry2, pillarMaterial);
            pillar3.position.x = x + roofSize.x / 2 - pillarSize.x / 2;
            pillar3.position.y = 0.4 + counterSize.y / 2;
            pillar3.position.z = z + facing * (roofSize.z / 2 - pillarSize.z / 2);
            this.scene.add(pillar3);
            addBoxBody(new THREE.Vector3(pillarSize.x, pillarSize.y - counterSize.y, pillarSize.z), pillar3.position);

            const pillar4 = new THREE.Mesh(pillarGeometry2, pillarMaterial);
            pillar4.position.x = x - roofSize.x / 2 + pillarSize.x / 2;
            pillar4.position.y = 0.4 + counterSize.y / 2;
            pillar4.position.z = z + facing * (roofSize.z / 2 - pillarSize.z / 2);
            this.scene.add(pillar4);
            addBoxBody(new THREE.Vector3(pillarSize.x, pillarSize.y - counterSize.y, pillarSize.z), pillar4.position);
        }

        const stallSpacingX = 2.5; // 屋台同士の間隔
        const stallCount = 7;
        const rowDistanceZ = 10;    // 中央の通路の広さ

        const startX = -((stallCount - 1) * stallSpacingX) / 2;

        for (let i = 0; i < stallCount; i++) {
            const x = startX + i * stallSpacingX;

            createStall(x, -rowDistanceZ / 2, 1, new THREE.Color(`hsl(${i*360/(stallCount)}, 100%, 50%)`));

            createStall(x, rowDistanceZ / 2, -1, new THREE.Color(`hsl(${i*(360/stallCount)}, 100%, 50%)`));
        }

        const phongMaterial = new THREE.MeshPhongMaterial({ color: 0xdaa520, shininess: 0 });
        const planeGeometry = new THREE.PlaneGeometry(25, 25);
        const planeMesh = new THREE.Mesh(planeGeometry, phongMaterial);
        planeMesh.material.side = THREE.DoubleSide; // 両面
        planeMesh.rotateX(-Math.PI / 2);
        this.scene.add(planeMesh);

        const planeShape = new CANNON.Plane();
        const planeBody = new CANNON.Body({ mass: 0 });
        planeBody.addShape(planeShape);
        planeBody.position.set(planeMesh.position.x, planeMesh.position.y, planeMesh.position.z);
        planeBody.quaternion.set(planeMesh.quaternion.x, planeMesh.quaternion.y, planeMesh.quaternion.z, planeMesh.quaternion.w);
        planeBody.collisionFilterGroup = COLLISION_GROUP_GROUND;
        planeBody.collisionFilterMask = COLLISION_GROUP_PARTICLE;
        world.addBody(planeBody);

        // グリッド表示
        /*const gridHelper = new THREE.GridHelper(10,);
        this.scene.add(gridHelper);

        // 軸表示
        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);*/

        //ライトの設定
        this.light = new THREE.DirectionalLight(0xffffff);
        const lvec = new THREE.Vector3(1, 1, 1).normalize();
        this.light.position.set(lvec.x, lvec.y, lvec.z);
        this.light.intensity = 0.2;
        this.scene.add(this.light);

        // 毎フレームのupdateを呼んで，更新
        // reqestAnimationFrame により次フレームを呼ぶ
        const update: FrameRequestCallback = (_time) => {

            world.fixedStep();

            for (const fw of this.fireworks) {
                // 高さをチェック
                if (!fw.exploded) {
                    const h = fw.groups[0].bodies[0].position.y;
                    if (h > fw.explodeHeight) {
                        fw.groups.forEach(explodeGroup);
                        fw.exploded = true;
                        for (const group of fw.groups) {
                            group.light.intensity = 300;
                        }
                    }
                } else {
                    for (const group of fw.groups) {
                        group.light.intensity *= 0.92;

                        const mat = group.points.material as THREE.PointsMaterial;
                        mat.size = mat.size * 0.990;
                    }
                }

                // 物理演算の結果を見た目に反映
                for (const group of fw.groups) {
                    const positions = (group.points.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
                    for (let i = 0; i < particleNum; i++) {
                        const p = group.bodies[i].position;
                        positions.setX(i, p.x);
                        positions.setY(i, p.y);
                        positions.setZ(i, p.z);
                    }
                    positions.needsUpdate = true;

                    group.light.position.copy(group.bodies[0].position as unknown as THREE.Vector3); // ライトの追従
                }
            }

            requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    }
}

window.addEventListener("DOMContentLoaded", init);

function init() {
    const container = new ThreeJSContainer();

    const viewport = container.createRendererDOM(640, 480, new THREE.Vector3(1, 5, 15));
    document.body.appendChild(viewport);
}