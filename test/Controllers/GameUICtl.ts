/**
 * 游戏UI控制类
 * @author: 落日羽音
 */

import GameFrame from '../../modules/core/GameFrame.js';
import GameMap from '../../modules/core/GameMap.js';
import {
  BlockInfo,
  Data,
  ResourceData,
  UnitData,
} from '../../modules/core/MapInfo.js';
import {
  OverlayType,
  RarityColor,
} from '../../modules/others/constants.js';
import {
  absPosToRealPos,
  realPosToAbsPos,
} from '../../modules/others/utils.js';
import StaticRenderer from '../../modules/renderers/StaticRenderer.js';
import Operator from '../../modules/units/Operator.js';
import {
  Vector2,
  Vector3,
} from '../../node_modules/three/build/three.module.js';
import GameController from './GameCtl.js';


/* 定义角色卡所需的资源数据接口，值均为地址字符串 */
interface CardData {
  icon: string;
  class: string;
  cost: string;
  rarity: string;
}


/**
 * UI控制类，用于构建游戏窗口中的UI，以及获取用户交互信息并传递给游戏控制类。
 */
class GameUIController {
  private cardChosen: boolean; // 干员卡选择状态，在点击后应设为true，取消状态后应设为false

  private readonly unitData: UnitData; // 单位名对应的单位数据

  private readonly matData: ResourceData; // 资源数据

  private readonly map: GameMap; // 地图对象

  private readonly frame: GameFrame; // 游戏框架，用于管理事件监听

  private readonly gameCtl: GameController; // 游戏控制器

  private readonly renderer: StaticRenderer; // 静态渲染器

  private readonly mouseLayer: HTMLElement; // 跟随光标位置的叠加层元素

  constructor(frame: GameFrame, map: GameMap, gameCtl: GameController, renderer: StaticRenderer, data: Data) {
    this.frame = frame;
    this.map = map;
    this.renderer = renderer;
    this.gameCtl = gameCtl;
    this.matData = data.materials;
    this.unitData = data.units;
    this.cardChosen = false;
    this.mouseLayer = document.querySelector('.mouse-overlay') as HTMLElement;

    /* 为画布（地面）上的点击事件绑定点击位置追踪函数 */
    this.frame.addEventListener(this.frame.canvas, 'click', this.trackMousePosition);
  }

  /**
   * 按指定的干员名称列表创建干员头像卡
   * @param oprList: 干员名称列表
   */
  addOprCard(oprList: string[]): void {
    const oprCardNode = document.querySelector('#operator-card') as HTMLElement;
    oprCardNode.childNodes.forEach((node) => { node.remove(); });
    oprList.forEach((opr) => {
      /* 收集干员信息 */
      const oprData = this.unitData.operator[opr];
      const cardData: CardData = {
        icon: this.matData.icons.operator[opr],
        class: this.matData.icons.prof[oprData.prof],
        cost: oprData.cost.toString(),
        rarity: this.matData.icons.rarity[oprData.rarity],
      };

      /* 转译攻击范围为Vector2数组 */
      const atkArea: Vector2[] = [];
      oprData.atkArea.forEach((tuple) => {
        atkArea.push(new Vector2(tuple[0], tuple[1]));
      });

      /* 创建节点元素 */
      const oprNode = document.createElement('div');
      oprNode.setAttribute('class', 'opr-card');
      oprNode.dataset.class = cardData.class;
      oprNode.dataset.cost = cardData.cost;
      oprNode.dataset.name = opr;
      oprNode.style.borderBottomColor = RarityColor[Number(oprData.rarity)];
      oprNode.style.background = `
        url("${cardData.class}") no-repeat top left/25%,
        url("${cardData.rarity}") no-repeat bottom right/45%,
        url("${cardData.icon}") no-repeat top left/cover`;

      const costNode = document.createElement('div');
      const costText = document.createTextNode(cardData.cost);
      costNode.setAttribute('class', 'opr-cost');
      costNode.appendChild(costText);
      oprNode.appendChild(costNode);
      oprCardNode.appendChild(oprNode);

      const placeLayer = this.map.getOverlay(OverlayType.PlaceLayer);
      const atkLayer = this.map.getOverlay(OverlayType.AttackLayer);

      /** 点击头像后，光标在画布上移动时执行光标位置追踪及静态渲染 */
      const canvasMousemoveHandler = (): void => {
        this.trackMouseOverlay();
        this.map.trackOverlay(atkLayer, atkArea);
        this.renderer.requestRender();
      };
      /** 当光标松开时的回调函数 */
      const mouseupCallback = (): void => {
        if (this.cardChosen) {
          this.cardChosen = false;
          this.map.hideOverlay();

          const chosenCard = document.querySelector('#chosen');
          if (chosenCard !== null) { chosenCard.removeAttribute('id'); } // 当干员卡还存在（未放置）时恢复未选定状态
          this.removeFromMouseOverlay();
          this.frame.removeEventListener(this.frame.canvas, 'mousemove', canvasMousemoveHandler);
          this.renderer.requestRender();
        }
      };

      /* 绑定干员头像上的按下事件 */
      oprNode.addEventListener('mousedown', () => {
        /* 显示UI */
        oprNode.setAttribute('id', 'chosen'); // 按下时进入选定状态
        placeLayer.setEnableArea(this.map.getPlaceableArea(oprData.posType));
        placeLayer.show(); // 设置总放置叠加层的可用区域并显示
        this.map.getOverlay(OverlayType.AttackLayer).hide(); // 隐藏上次显示的区域
        this.renderer.requestRender();
        this.cardChosen = true;

        /* 添加干员图片到指针叠加层元素 */
        const oprRes = this.matData.resources.operator[opr];
        const img = document.createElement('img');
        img.setAttribute('src', oprRes.url);
        this.mouseLayer.appendChild(img);

        /* 绑定画布上的光标移动及抬起事件（单次） */
        this.frame.addEventListener(this.frame.canvas, 'mousemove', canvasMousemoveHandler);
        this.frame.canvas.addEventListener('mouseup', () => {
          if (this.map.tracker.pickPos !== null) {
            const pos = realPosToAbsPos(this.map.tracker.pickPos, true);
            if (placeLayer.has(pos)) {
              const unit = this.gameCtl.createOperator(opr, oprData);
              if (unit !== null) {
                this.map.addUnit(pos.x, pos.y, unit); // 仅当创建成功时添加至地图
                this.setDirection(unit);
                // this.removeOprCard(oprNode); // TODO: 上场后需要确认剩余数量后再决定是否删除节点
              }
            }
          }
          mouseupCallback();
        }, { once: true });
      });

      /* 绑定干员头像上的抬起事件 */
      oprNode.addEventListener('mouseup', mouseupCallback);
    });
  }

  // removeOprCard(card: HTMLElement): void {
  //   card.remove();
  // }

  // enableOprCard(card: HTMLElement): void {
  //   card.style.filter = '';
  // }

  // disableOprCard(card: HTMLElement): void {
  //   card.style.filter = 'brightness(50%)';
  // }

  /**
   * 选择设置干员的朝向及攻击区域
   * @param opr: 干员实例
   */
  private setDirection(opr: Operator): void {
    const atkLayer = this.map.getOverlay(OverlayType.AttackLayer);
    atkLayer.hide();
    const layer = document.querySelector('.select-overlay') as HTMLCanvasElement;
    layer.width = this.frame.canvas.width;
    layer.height = this.frame.canvas.height;

    const ctx = layer.getContext('2d') as CanvasRenderingContext2D;

    /* 叠加层定位 */
    const pickPos = realPosToAbsPos(this.map.tracker.pickPos as Vector2, true); // 获取点击处的砖块抽象坐标
    const height = (this.map.getBlock(pickPos) as BlockInfo).size.y; // 点击处砖块高度
    const realPos = absPosToRealPos(pickPos.x + 0.5, pickPos.y + 0.5); // 将点击处的砖块中心抽象坐标转换为世界坐标
    const normalizedSize = new Vector3(realPos.x, height, realPos.y).project(this.frame.camera); // 转换为标准化CSS坐标
    const centerX = (normalizedSize.x * 0.5 + 0.5) * this.frame.canvas.width; // 中心X坐标
    const centerY = (normalizedSize.y * -0.5 + 0.5) * this.frame.canvas.height; // 中心Y坐标

    const aziAngle = this.frame.controls.getAzimuthalAngle(); // 镜头控制器的方位角 0.25-0.75在右侧 -0.25-0.25正面
    const rad = layer.width * 0.1; // 方向选择区半径
    let newArea: Vector2[] = []; // 干员的新攻击范围

    /** 绘制背景区域初始状态 */
    const drawBackGround = (): void => {
      ctx.clearRect(0, 0, layer.width, layer.height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, layer.width, layer.height);

      ctx.strokeStyle = 'white';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(centerX, centerY, rad, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'blue';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    };

    /** 动画渲染 */
    const drawSelector = (e: MouseEvent): void => {
      atkLayer.hide();
      drawBackGround();
      /* 判定光标位置是在中心还是在外部 */
      const distX = e.clientX - centerX / 2;
      const distY = e.clientY - centerY / 2;
      const dist = Math.sqrt(distX ** 2 + distY ** 2);
      if (dist < rad / 4) {
        ctx.strokeStyle = 'white';
        ctx.beginPath();
        ctx.arc(centerX, centerY, rad / 2, 0, 2 * Math.PI);
        ctx.stroke();
        atkLayer.hide();
      } else {
        /* 绘制方向指示 */
        const theta = Math.atan2(distY, distX); // 与X方向夹角
        ctx.strokeStyle = 'gold';
        ctx.beginPath();
        ctx.arc(centerX, centerY, rad + 20, theta - Math.PI / 4, theta + Math.PI / 4);
        ctx.stroke();

        /* 判定镜头及光标方位，旋转模型及叠加层 */
        const tempAzi = aziAngle - 0.25 * Math.PI; // 重置方位角为四个象限
        const sinAzi = Math.sin(tempAzi) > 0; // 镜头二象限判定
        const cosAzi = Math.cos(tempAzi) > 0; // 镜头四象限判定
        const tanAzi = Math.tan(tempAzi) > 0; // 镜头三象限判定
        const andAzi = sinAzi && cosAzi && tanAzi; // 镜头一象限判定

        const tempTheta = theta - 0.25 * Math.PI;
        const sinTheta = Math.sin(tempTheta) > 0; // 朝向二象限判定
        const cosTheta = Math.cos(tempTheta) > 0; // 朝向四象限判定
        const tanTheta = Math.tan(tempTheta) > 0; // 朝向三象限判定
        const andTheta = sinTheta && cosTheta && tanTheta; // 朝向一象限判定

        const narrowBool = !andTheta && !andAzi; // 当镜头方位角在一象限时三个判定均为true，会导致提前进入其他镜头方位角的分支

        newArea = []; // 清除上次设置的攻击区域
        if ((andAzi && andTheta)
          || (sinAzi && sinTheta && narrowBool)
          || (tanAzi && tanTheta && narrowBool)
          || (cosAzi && cosTheta && narrowBool)) {
          /* 正面向右 */
          opr.mesh.rotation.y = 0;
          newArea = opr.atkArea;
        } else if ((andAzi && sinTheta)
          || (sinAzi && tanTheta && narrowBool)
          || (tanAzi && cosTheta && narrowBool)
          || (cosAzi && andTheta)) {
          /* 正面向下 */
          opr.mesh.rotation.y = -0.5 * Math.PI;
          opr.atkArea.forEach((area) => {
            newArea.push(new Vector2(-area.y, area.x));
          });
        } else if ((andAzi && tanTheta)
          || (sinAzi && cosTheta && narrowBool)
          || (tanAzi && andTheta)
          || (cosAzi && sinTheta)) {
          /* 正面向左 */
          opr.mesh.rotation.y = Math.PI;
          opr.atkArea.forEach((area) => {
            newArea.push(new Vector2(-area.x, -area.y));
          });
        } else if ((andAzi && cosTheta)
          || (sinAzi && andTheta)
          || (tanAzi && sinTheta)
          || (cosAzi && tanTheta)) {
          /* 正面向上 */
          opr.mesh.rotation.y = 0.5 * Math.PI;
          opr.atkArea.forEach((area) => {
            newArea.push(new Vector2(area.y, -area.x));
          });
        }
        GameMap.showArea(atkLayer, pickPos, newArea);
      }
      this.renderer.requestRender();
    };

    /** 选择方向时的点击事件 */
    const selectDirection = (e: MouseEvent): void => {
      /* 判定光标位置是在中心还是在外部 */
      const distX = e.clientX - centerX / 2;
      const distY = e.clientY - centerY / 2;
      const dist = Math.sqrt(distX ** 2 + distY ** 2);
      if (dist > rad / 4) {
        opr.atkArea = newArea; // 更新攻击范围
        this.gameCtl.activeOperator.set(opr.name, opr); // 添加干员到游戏控制器
      } else {
        this.map.removeUnit(opr);
      }
      this.frame.removeEventListener(layer, 'mousemove', drawSelector);
      this.frame.removeEventListener(layer, 'click', selectDirection);
      atkLayer.hide();
      layer.style.display = 'none';
      this.renderer.requestRender();
    };

    drawBackGround();
    this.frame.addEventListener(layer, 'mousemove', drawSelector);
    this.frame.addEventListener(layer, 'click', selectDirection);
    layer.style.display = 'block';
  }

  /** 移除光标叠加层元素中的子元素 */
  private removeFromMouseOverlay(): void {
    this.mouseLayer.style.left = '-1000px';
    this.mouseLayer.style.top = '-1000px';
    this.mouseLayer.childNodes.forEach((node) => { node.remove(); });
  }

  /** 追踪光标位置叠加层元素 */
  private trackMouseOverlay(): void {
    if (this.map.tracker.pointerPos !== null) {
      const imgRect = (this.mouseLayer.children.item(0) as HTMLElement).getBoundingClientRect();
      this.mouseLayer.style.left = `${this.map.tracker.pointerPos.x - imgRect.width / 2}px`;
      this.mouseLayer.style.top = `${this.map.tracker.pointerPos.y - imgRect.height / 2}px`;
    }
  }

  /** 光标位置追踪回调 */
  private trackMousePosition = (): void => {
    const { pickPos } = this.map.tracker;
    if (pickPos !== null) {
      const absPos = realPosToAbsPos(pickPos, true);
      const block = this.map.getBlock(absPos);
      if (block !== null) {
        this.gameCtl.activeOperator.forEach((opr) => {
          if (absPos.equals(opr.position.floor())) {
            console.log('选择干员', opr);
          }
        });
      }
    }
  };
}


export default GameUIController;
