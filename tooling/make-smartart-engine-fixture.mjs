/**
 * 生成确定性固件 fixtures/sample-smartart-engine.pptx —— 覆盖 ECMA-376 §21.4.2 全部十种布局定义算法、
 * 条件分支（var / cnt / depth / maxDepth / revPos / posOdd）、递归 forEach ref、过渡点（parTrans / sibTrans）与规则收缩。
 * 全部页面均不携带缓存 drawing，直接验收默认渲染路径与编辑保存重排。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { deck, makeZip, NS, px, slideXml, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280;
const H = 720;
const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const tx = (s) => `<dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>${s}</a:t></a:r></a:p></dgm:t>`;

/** tree 节点支持 [文本, 子节点[], 类型('node'|'asst')] */
function dataModel(tree) {
  const pts = [`<dgm:pt modelId="0" type="doc"><dgm:prSet/><dgm:spPr/></dgm:pt>`];
  const cxns = [];
  let seq = 0;
  const walk = (nodes, parentId) => {
    nodes.forEach(([label, children = [], ptType = 'node'], i) => {
      const n = ++seq;
      const id = String(n);
      const parId = String(1000 + n);
      const sibId = String(2000 + n);
      const cxnId = String(3000 + n);
      const typeAttr = ptType === 'node' ? '' : ` type="${ptType}"`;
      pts.push(`<dgm:pt modelId="${id}"${typeAttr}><dgm:prSet/><dgm:spPr/>${tx(label)}</dgm:pt>`);
      pts.push(`<dgm:pt modelId="${parId}" type="parTrans" cxnId="${cxnId}"><dgm:prSet/><dgm:spPr/></dgm:pt>`);
      pts.push(`<dgm:pt modelId="${sibId}" type="sibTrans" cxnId="${cxnId}"><dgm:prSet/><dgm:spPr/></dgm:pt>`);
      cxns.push(
        `<dgm:cxn modelId="${cxnId}" srcId="${parentId}" destId="${id}" srcOrd="${i}" destOrd="0" parTransId="${parId}" sibTransId="${sibId}"/>`,
      );
      walk(children, id);
    });
  };
  walk(tree, '0');
  return `${XML}<dgm:dataModel xmlns:dgm="${DGM}" xmlns:a="${NS.a}"><dgm:ptLst>${pts.join('')}</dgm:ptLst><dgm:cxnLst>${cxns.join('')}</dgm:cxnLst><dgm:bg/><dgm:whole/></dgm:dataModel>`;
}

const wrapLayout = (uid, body) =>
  `${XML}<dgm:layoutDef xmlns:dgm="${DGM}" xmlns:a="${NS.a}" uniqueId="${uid}"><dgm:title val=""/><dgm:desc val=""/>${body}</dgm:layoutDef>`;

// 1. lin 横向流程 + sibTrans 箭头（revPos 隐藏末尾过渡）+ userA 变量
const LIN_HORIZ_LAYOUT = wrapLayout(
  'urn:web-ppt/smartart-engine/lin-process',
  `<dgm:layoutNode name="root">
    <dgm:varLst><dgm:dir val="norm"/></dgm:varLst>
    <dgm:choose>
      <dgm:if func="var" arg="dir" op="equ" val="norm"><dgm:alg type="lin"><dgm:param type="linDir" val="fromL"/></dgm:alg></dgm:if>
      <dgm:else><dgm:alg type="lin"><dgm:param type="linDir" val="fromR"/></dgm:alg></dgm:else>
    </dgm:choose>
    <dgm:constrLst>
      <dgm:constr type="userA" for="ch" ptType="node" refType="w"/>
      <dgm:constr type="h" for="ch" ptType="node" refType="h" fact="0.55"/>
      <dgm:constr type="w" for="ch" forName="arrowSep" refType="w" fact="0.06"/>
      <dgm:constr type="h" for="ch" forName="arrowSep" refType="h" fact="0.22"/>
      <dgm:constr type="primFontSz" for="ch" ptType="node" val="28"/>
    </dgm:constrLst>
    <dgm:forEach name="items" axis="ch" ptType="node">
      <dgm:layoutNode name="stepBox">
        <dgm:alg type="tx"/>
        <dgm:shape type="roundRect"/>
        <dgm:presOf axis="self" ptType="node"/>
        <dgm:constrLst><dgm:constr type="w" refType="userA" fact="0.24"/></dgm:constrLst>
        <dgm:ruleLst><dgm:rule type="primFontSz" val="8"/></dgm:ruleLst>
      </dgm:layoutNode>
      <dgm:choose>
        <dgm:if func="revPos" op="equ" val="1"/>
        <dgm:else>
          <dgm:layoutNode name="arrowSep"><dgm:alg type="sp"/><dgm:shape type="rightArrow"/><dgm:presOf/></dgm:layoutNode>
        </dgm:else>
      </dgm:choose>
    </dgm:forEach>
  </dgm:layoutNode>`,
);

// 2. lin 纵向交替（posOdd 左右切换）
const LIN_ALT_LAYOUT = wrapLayout(
  'urn:web-ppt/smartart-engine/lin-alternating',
  `<dgm:layoutNode name="root">
    <dgm:alg type="lin"><dgm:param type="linDir" val="fromT"/></dgm:alg>
    <dgm:constrLst><dgm:constr type="sibSp" val="14"/></dgm:constrLst>
    <dgm:forEach name="rows" axis="ch" ptType="node">
      <dgm:layoutNode name="rowComp">
        <dgm:alg type="composite"/>
        <dgm:choose>
          <dgm:if func="posOdd" op="equ" val="1">
            <dgm:constrLst>
              <dgm:constr type="l" for="ch" forName="badge" val="0"/>
              <dgm:constr type="w" for="ch" forName="badge" refType="w" fact="0.72"/>
              <dgm:constr type="h" for="ch" forName="badge" refType="h"/>
            </dgm:constrLst>
          </dgm:if>
          <dgm:else>
            <dgm:constrLst>
              <dgm:constr type="r" for="ch" forName="badge" refType="w"/>
              <dgm:constr type="w" for="ch" forName="badge" refType="w" fact="0.72"/>
              <dgm:constr type="h" for="ch" forName="badge" refType="h"/>
            </dgm:constrLst>
          </dgm:else>
        </dgm:choose>
        <dgm:layoutNode name="badge">
          <dgm:alg type="tx"/><dgm:shape type="hexagon"/><dgm:presOf axis="self" ptType="node"/>
          <dgm:constrLst><dgm:constr type="primFontSz" val="22"/></dgm:constrLst>
        </dgm:layoutNode>
      </dgm:layoutNode>
    </dgm:forEach>
  </dgm:layoutNode>`,
);

// 3. cycle 圆周 + sibTrans 连线（hideLastTrans="0" 闭合圆环）
const CYCLE_RING_LAYOUT = wrapLayout(
  'urn:web-ppt/smartart-engine/cycle-ring',
  `<dgm:layoutNode name="root">
    <dgm:alg type="cycle"><dgm:param type="stAng" val="0"/><dgm:param type="spanAng" val="360"/></dgm:alg>
    <dgm:constrLst><dgm:constr type="primFontSz" for="des" val="20"/></dgm:constrLst>
    <dgm:forEach name="ring" axis="ch" ptType="node">
      <dgm:layoutNode name="ringNode">
        <dgm:alg type="tx"/><dgm:shape type="ellipse"/><dgm:presOf axis="self" ptType="node"/>
      </dgm:layoutNode>
      <dgm:forEach name="ringConn" axis="followSib" ptType="sibTrans" hideLastTrans="0" cnt="1">
        <dgm:layoutNode name="arcConn">
          <dgm:alg type="conn"><dgm:param type="connRout" val="curve"/></dgm:alg>
          <dgm:shape type="conn" zOrderOff="-10"/>
          <dgm:presOf axis="self"/>
        </dgm:layoutNode>
      </dgm:forEach>
    </dgm:forEach>
  </dgm:layoutNode>`,
);

// 4. cycle 径向（ctrShpMap="fNode"，首节点居中、其余环绕）
const CYCLE_RADIAL_LAYOUT = wrapLayout(
  'urn:web-ppt/smartart-engine/cycle-radial',
  `<dgm:layoutNode name="root">
    <dgm:alg type="cycle"><dgm:param type="ctrShpMap" val="fNode"/><dgm:param type="stAng" val="0"/><dgm:param type="spanAng" val="360"/></dgm:alg>
    <dgm:constrLst><dgm:constr type="primFontSz" for="des" val="20"/></dgm:constrLst>
    <dgm:forEach name="allPts" axis="desOrSelf" ptType="node">
      <dgm:layoutNode name="satNode">
        <dgm:alg type="tx"/><dgm:shape type="ellipse"/><dgm:presOf axis="self" ptType="node"/>
      </dgm:layoutNode>
    </dgm:forEach>
  </dgm:layoutNode>`,
);

// 5. pyra 棱锥 + 长文本规则收缩重试
const PYRA_LAYOUT = wrapLayout(
  'urn:web-ppt/smartart-engine/pyramid',
  `<dgm:layoutNode name="root">
    <dgm:alg type="pyra"><dgm:param type="linDir" val="fromT"/></dgm:alg>
    <dgm:constrLst>
      <dgm:constr type="sibSp" val="8"/>
      <dgm:constr type="primFontSz" for="ch" val="36"/>
    </dgm:constrLst>
    <dgm:forEach name="bands" axis="ch" ptType="node">
      <dgm:layoutNode name="band">
        <dgm:alg type="tx"/><dgm:shape type="trapezoid"/><dgm:presOf axis="self" ptType="node"/>
        <dgm:ruleLst><dgm:rule type="primFontSz" val="9" fact="0.9" max="30"/></dgm:ruleLst>
      </dgm:layoutNode>
    </dgm:forEach>
  </dgm:layoutNode>`,
);

// 6. hierRoot + hierChild + conn（含 asst 助理、hierBranch=init 深度自适应悬挂、递归 forEach ref）
const HIER_ORG_LAYOUT = wrapLayout(
  'urn:web-ppt/smartart-engine/org-chart',
  `<dgm:layoutNode name="orgEntry">
    <dgm:alg type="hierChild"><dgm:param type="linDir" val="fromL"/></dgm:alg>
    <dgm:constrLst>
      <dgm:constr type="w" for="des" forName="rootComposite1" refType="w" fact="10"/>
      <dgm:constr type="h" for="des" forName="rootComposite1" refType="w" refFor="des" refForName="rootComposite1" fact="0.5"/>
      <dgm:constr type="w" for="des" forName="rootComposite2" refType="w" fact="10"/>
      <dgm:constr type="h" for="des" forName="rootComposite2" refType="w" refFor="des" refForName="rootComposite1" fact="0.5"/>
      <dgm:constr type="w" for="des" forName="rootComposite3" refType="w" fact="10"/>
      <dgm:constr type="h" for="des" forName="rootComposite3" refType="w" refFor="des" refForName="rootComposite1" fact="0.5"/>
      <dgm:constr type="sp" for="des" forName="hierRoot1" refType="w" refFor="des" refForName="rootComposite1" fact="0.22"/>
      <dgm:constr type="sibSp" refType="w" refFor="des" refForName="rootComposite1" fact="0.2"/>
      <dgm:constr type="primFontSz" for="des" ptType="node" op="equ"/>
    </dgm:constrLst>
    <dgm:forEach name="topRoots" axis="ch" ptType="nonAsst">
      <dgm:layoutNode name="hierRoot1">
        <dgm:varLst><dgm:hierBranch val="init"/></dgm:varLst>
        <dgm:alg type="hierRoot"/>
        <dgm:layoutNode name="rootComposite1">
          <dgm:alg type="composite"/>
          <dgm:constrLst>
            <dgm:constr type="w" for="ch" forName="boxTx1" refType="w"/>
            <dgm:constr type="h" for="ch" forName="boxTx1" refType="h"/>
            <dgm:constr type="w" for="ch" forName="rootConnector1" refType="w" fact="0.2"/>
            <dgm:constr type="h" for="ch" forName="rootConnector1" refType="h"/>
          </dgm:constrLst>
          <dgm:layoutNode name="boxTx1">
            <dgm:alg type="tx"/><dgm:shape type="roundRect"/><dgm:presOf axis="self" ptType="node" cnt="1"/>
            <dgm:constrLst><dgm:constr type="primFontSz" val="28"/></dgm:constrLst>
            <dgm:ruleLst><dgm:rule type="primFontSz" val="8"/></dgm:ruleLst>
          </dgm:layoutNode>
          <dgm:layoutNode name="rootConnector1">
            <dgm:alg type="sp"/><dgm:shape type="rect" hideGeom="1"/><dgm:presOf axis="self" ptType="node" cnt="1"/>
          </dgm:layoutNode>
        </dgm:layoutNode>
        <dgm:layoutNode name="normKids">
          <dgm:alg type="hierChild"><dgm:param type="linDir" val="fromL"/></dgm:alg>
          <dgm:forEach name="subLoop" axis="ch" ptType="nonAsst">
            <dgm:forEach name="subParTrans" axis="precedSib" ptType="parTrans" st="-1" cnt="1">
              <dgm:layoutNode name="edgeConn">
                <dgm:choose name="edgeChoose">
                  <dgm:if name="edgeTopLvl" axis="self" func="depth" op="lte" val="2">
                    <dgm:alg type="conn"><dgm:param type="connRout" val="bend"/><dgm:param type="begPts" val="bCtr"/><dgm:param type="endPts" val="tCtr"/></dgm:alg>
                  </dgm:if>
                  <dgm:else name="edgeDeep">
                    <dgm:choose name="edgeHangChoose">
                      <dgm:if name="edgeHangIf" axis="par des" func="maxDepth" op="lte" val="1">
                        <dgm:alg type="conn"><dgm:param type="connRout" val="bend"/><dgm:param type="begPts" val="bCtr"/><dgm:param type="endPts" val="midL midR"/><dgm:param type="srcNode" val="rootConnector"/></dgm:alg>
                      </dgm:if>
                      <dgm:else name="edgeStdElse">
                        <dgm:alg type="conn"><dgm:param type="connRout" val="bend"/><dgm:param type="begPts" val="bCtr"/><dgm:param type="endPts" val="tCtr"/></dgm:alg>
                      </dgm:else>
                    </dgm:choose>
                  </dgm:else>
                </dgm:choose>
                <dgm:shape type="conn" zOrderOff="-99999"/>
                <dgm:presOf axis="self"/>
              </dgm:layoutNode>
            </dgm:forEach>
            <dgm:layoutNode name="subRoot">
              <dgm:varLst><dgm:hierBranch val="init"/></dgm:varLst>
              <dgm:choose name="subRootChoose">
                <dgm:if name="subRootHang" axis="des" func="maxDepth" op="lte" val="1">
                  <dgm:alg type="hierRoot"><dgm:param type="hierAlign" val="tL"/></dgm:alg>
                  <dgm:constrLst><dgm:constr type="alignOff" val="0.25"/></dgm:constrLst>
                </dgm:if>
                <dgm:else name="subRootStd"><dgm:alg type="hierRoot"/></dgm:else>
              </dgm:choose>
              <dgm:layoutNode name="rootComposite2">
                <dgm:alg type="composite"/>
                <dgm:constrLst>
                  <dgm:constr type="w" for="ch" forName="boxTx2" refType="w"/>
                  <dgm:constr type="h" for="ch" forName="boxTx2" refType="h"/>
                  <dgm:constr type="w" for="ch" forName="rootConnector2" refType="w" fact="0.2"/>
                  <dgm:constr type="h" for="ch" forName="rootConnector2" refType="h"/>
                </dgm:constrLst>
                <dgm:layoutNode name="boxTx2">
                  <dgm:alg type="tx"/><dgm:shape type="roundRect"/><dgm:presOf axis="self" ptType="node" cnt="1"/>
                  <dgm:constrLst><dgm:constr type="primFontSz" val="28"/></dgm:constrLst>
                  <dgm:ruleLst><dgm:rule type="primFontSz" val="8"/></dgm:ruleLst>
                </dgm:layoutNode>
                <dgm:layoutNode name="rootConnector2">
                  <dgm:alg type="sp"/><dgm:shape type="rect" hideGeom="1"/><dgm:presOf axis="self" ptType="node" cnt="1"/>
                </dgm:layoutNode>
              </dgm:layoutNode>
              <dgm:layoutNode name="subKids">
                <dgm:choose name="subKidsChoose">
                  <dgm:if name="subKidsHang" axis="des" func="maxDepth" op="lte" val="1">
                    <dgm:alg type="hierChild"><dgm:param type="chAlign" val="l"/><dgm:param type="linDir" val="fromT"/></dgm:alg>
                  </dgm:if>
                  <dgm:else name="subKidsStd"><dgm:alg type="hierChild"><dgm:param type="linDir" val="fromL"/></dgm:alg></dgm:else>
                </dgm:choose>
                <dgm:forEach name="subLoopRef" ref="subLoop"/>
              </dgm:layoutNode>
              <dgm:layoutNode name="subAsst">
                <dgm:alg type="hierChild"><dgm:param type="linDir" val="fromL"/><dgm:param type="secLinDir" val="fromT"/></dgm:alg>
                <dgm:forEach name="asstLoopRef" ref="asstLoop"/>
              </dgm:layoutNode>
            </dgm:layoutNode>
          </dgm:forEach>
        </dgm:layoutNode>
        <dgm:layoutNode name="asstKids">
          <dgm:alg type="hierChild"><dgm:param type="linDir" val="fromL"/><dgm:param type="secLinDir" val="fromT"/></dgm:alg>
          <dgm:forEach name="asstLoop" axis="ch" ptType="asst">
            <dgm:forEach name="asstParTrans" axis="precedSib" ptType="parTrans" st="-1" cnt="1">
              <dgm:layoutNode name="asstConn">
                <dgm:alg type="conn"><dgm:param type="connRout" val="bend"/><dgm:param type="begPts" val="bCtr"/><dgm:param type="endPts" val="midL midR"/></dgm:alg>
                <dgm:shape type="conn" zOrderOff="-99999"/>
                <dgm:presOf axis="self"/>
              </dgm:layoutNode>
            </dgm:forEach>
            <dgm:layoutNode name="asstRoot">
              <dgm:alg type="hierRoot"><dgm:param type="hierAlign" val="tL"/></dgm:alg>
              <dgm:layoutNode name="rootComposite3">
                <dgm:alg type="composite"/>
                <dgm:layoutNode name="boxTx3">
                  <dgm:alg type="tx"/><dgm:shape type="roundRect"/><dgm:presOf axis="self" ptType="node" cnt="1"/>
                  <dgm:constrLst><dgm:constr type="primFontSz" val="28"/></dgm:constrLst>
                  <dgm:ruleLst><dgm:rule type="primFontSz" val="8"/></dgm:ruleLst>
                </dgm:layoutNode>
              </dgm:layoutNode>
            </dgm:layoutNode>
          </dgm:forEach>
        </dgm:layoutNode>
      </dgm:layoutNode>
    </dgm:forEach>
  </dgm:layoutNode>`,
);

// 7. snake 蛇形网格（contDir=revDir 折返 + composite 子块）
const SNAKE_GRID_LAYOUT = wrapLayout(
  'urn:web-ppt/smartart-engine/snake-grid',
  `<dgm:layoutNode name="root">
    <dgm:alg type="snake">
      <dgm:param type="grDir" val="tL"/>
      <dgm:param type="flowDir" val="row"/>
      <dgm:param type="contDir" val="revDir"/>
      <dgm:param type="off" val="ctr"/>
    </dgm:alg>
    <dgm:constrLst><dgm:constr type="sp" val="16"/></dgm:constrLst>
    <dgm:forEach name="cells" axis="ch" ptType="node">
      <dgm:layoutNode name="cell">
        <dgm:alg type="composite"><dgm:param type="ar" val="1.5"/></dgm:alg>
        <dgm:constrLst>
          <dgm:constr type="w" for="ch" forName="card" refType="w"/>
          <dgm:constr type="h" for="ch" forName="card" refType="h"/>
        </dgm:constrLst>
        <dgm:layoutNode name="card">
          <dgm:alg type="tx"/><dgm:shape type="roundRect"/><dgm:presOf axis="self" ptType="node"/>
          <dgm:constrLst><dgm:constr type="primFontSz" val="22"/></dgm:constrLst>
          <dgm:ruleLst><dgm:rule type="primFontSz" val="8"/></dgm:ruleLst>
        </dgm:layoutNode>
      </dgm:layoutNode>
    </dgm:forEach>
  </dgm:layoutNode>`,
);

const colorsXml = `${XML}<dgm:colorsDef xmlns:dgm="${DGM}" xmlns:a="${NS.a}" uniqueId="urn:web-ppt/smartart-engine/colors">
<dgm:title val=""/><dgm:desc val=""/>
<dgm:styleLbl name="node0"><dgm:fillClrLst meth="repeat">
<a:schemeClr val="accent1"/><a:schemeClr val="accent2"/><a:schemeClr val="accent3"/>
<a:schemeClr val="accent4"/><a:schemeClr val="accent5"/><a:schemeClr val="accent6"/>
</dgm:fillClrLst><dgm:linClrLst meth="repeat"><a:schemeClr val="lt1"/></dgm:linClrLst>
<dgm:effectClrLst/><dgm:txLinClrLst/><dgm:txFillClrLst/><dgm:txEffectClrLst/>
</dgm:styleLbl></dgm:colorsDef>`;

const quickStyleXml = `${XML}<dgm:styleDef xmlns:dgm="${DGM}" xmlns:a="${NS.a}" uniqueId="urn:web-ppt/smartart-engine/style">
<dgm:title val=""/><dgm:desc val=""/><dgm:styleLbl name="node0"><dgm:style>
<a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef>
<a:fillRef idx="2"><a:schemeClr val="accent1"/></a:fillRef>
<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
</dgm:style></dgm:styleLbl></dgm:styleDef>`;

const CASES = [
  {
    title: '引擎 · lin 横向流程与末尾过渡抑制',
    tree: [['立项'], ['架构'], ['编码'], ['验证']],
    layout: LIN_HORIZ_LAYOUT,
  },
  {
    title: '引擎 · lin 纵向奇偶交替（posOdd）',
    tree: [['阶段一'], ['阶段二'], ['阶段三'], ['阶段四']],
    layout: LIN_ALT_LAYOUT,
  },
  {
    title: '引擎 · cycle 圆周闭合与过渡连线',
    tree: [['洞察'], ['规划'], ['执行'], ['复盘']],
    layout: CYCLE_RING_LAYOUT,
  },
  {
    title: '引擎 · cycle 径向中心映射（ctrShpMap=fNode）',
    tree: [['核心引擎', [['解析'], ['布局'], ['渲染'], ['导出']]]],
    layout: CYCLE_RADIAL_LAYOUT,
  },
  {
    title: '引擎 · pyra 棱锥与长文本规则收缩',
    tree: [['顶层战略愿景与长期核心价值主张锚点体系（长文本触发规则收缩并全组统一字号）'], ['关键战略方向'], ['持续交付度量指标']],
    layout: PYRA_LAYOUT,
  },
  {
    title: '引擎 · hierRoot / hierChild / conn（含助理与深度悬挂）',
    tree: [
      [
        '总监',
        [
          ['平台组', [['内核'], ['编辑器', [['视图'], ['手势']]]]],
          ['体验组', [['视觉'], ['交互']]],
          ['架构助理', [], 'asst'],
        ],
      ],
    ],
    layout: HIER_ORG_LAYOUT,
  },
  {
    title: '引擎 · snake 蛇形折返网格（contDir=revDir）',
    tree: [['S1'], ['S2'], ['S3'], ['S4'], ['S5'], ['S6']],
    layout: SNAKE_GRID_LAYOUT,
  },
];

const slides = CASES.map((c, i) =>
  slideXml(
    sp({
      x: 40,
      y: 24,
      w: 960,
      h: 34,
      prst: 'rect',
      fill: '<a:noFill/>',
      text: `<a:p><a:r><a:rPr sz="1600" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>${c.title}</a:t></a:r></a:p>`,
    })
      + `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${600 + i}" name="EngineSmartArt${i}"/>
<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(120)}" y="${px(96)}"/><a:ext cx="${px(1040)}" cy="${px(540)}"/></p:xfrm>
<a:graphic><a:graphicData uri="${DGM}">
<dgm:relIds xmlns:dgm="${DGM}" xmlns:r="${NS.r}" r:dm="rId2" r:lo="rId3" r:qs="rId4" r:cs="rId5"/>
</a:graphicData></a:graphic></p:graphicFrame>`,
  ),
);

const zip = deck({ name: 'SmartArtEngine', width: W, height: H, slides });
const files = unzipSync(zip);
const entries = Object.entries(files).map(([k, v]) => [k, v]);
const dec = new TextDecoder();

CASES.forEach((c, i) => {
  const n = i + 1;
  entries.push([`ppt/diagrams/data${n}.xml`, dataModel(c.tree)]);
  entries.push([`ppt/diagrams/layout${n}.xml`, c.layout]);
  entries.push([`ppt/diagrams/quickStyle${n}.xml`, quickStyleXml]);
  entries.push([`ppt/diagrams/colors${n}.xml`, colorsXml]);

  const rels = [
    `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
    `<Relationship Id="rId2" Type="${REL}/diagramData" Target="../diagrams/data${n}.xml"/>`,
    `<Relationship Id="rId3" Type="${REL}/diagramLayout" Target="../diagrams/layout${n}.xml"/>`,
    `<Relationship Id="rId4" Type="${REL}/diagramQuickStyle" Target="../diagrams/quickStyle${n}.xml"/>`,
    `<Relationship Id="rId5" Type="${REL}/diagramColors" Target="../diagrams/colors${n}.xml"/>`,
  ];
  const idx = entries.findIndex(([k]) => k === `ppt/slides/_rels/slide${n}.xml.rels`);
  entries[idx] = [`ppt/slides/_rels/slide${n}.xml.rels`, `${XML}<Relationships xmlns="${NS.rel}">${rels.join('')}</Relationships>`];
});

const ctIdx = entries.findIndex(([k]) => k === '[Content_Types].xml');
let ct = dec.decode(entries[ctIdx][1]);
const overrides = CASES.map((_, i) => {
  const n = i + 1;
  return (
    `<Override PartName="/ppt/diagrams/data${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml"/>`
    + `<Override PartName="/ppt/diagrams/layout${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml"/>`
    + `<Override PartName="/ppt/diagrams/quickStyle${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml"/>`
    + `<Override PartName="/ppt/diagrams/colors${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml"/>`
  );
}).join('');
ct = ct.replace('</Types>', `${overrides}</Types>`);
entries[ctIdx] = ['[Content_Types].xml', ct];

const out = makeZip(entries);
writeFileSync(join(root, 'fixtures/sample-smartart-engine.pptx'), out);
console.log(`fixtures/sample-smartart-engine.pptx 已生成（${CASES.length} 页，${(out.length / 1024).toFixed(1)} KB）`);
