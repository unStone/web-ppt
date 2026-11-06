import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, 'out/ooxml-schemas');
const sources = [
  {
    url: 'https://ecma-international.org/wp-content/uploads/ECMA-376-2_5th_edition_december_2021.zip',
    sha256: '1d489dc491168ea1f9e9a59063acc8dd5f02b4ad1d21aa7ec19ba9a58d020c70',
    nested: 'OpenPackagingConventions-XMLSchema.zip',
  },
  {
    url: 'https://ecma-international.org/wp-content/uploads/ECMA-376-4_5th_edition_december_2016.zip',
    sha256: 'bd25da1109f73762356596918bf5ff8b74a1331642dba5f1c1d1dfc6bed34ecd',
    nested: 'OfficeOpenXML-XMLSchema-Transitional.zip',
  },
];

async function download(url, sha256) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`OOXML schema 下载失败 ${response.status}：${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256) throw new Error(`OOXML schema SHA256 不符：${url}\n预期 ${sha256}\n实际 ${actual}`);
  return bytes;
}

export async function prepareOoxmlSchemas() {
  mkdirSync(directory, { recursive: true });
  // 首次成功后写标记跳过下载：schema 是钉版内容，重复下载只增加代理与站点的失败面。
  // CI 用 actions/cache 复用整个目录；删除 out/ooxml-schemas/.complete 可强制重下。
  const marker = join(directory, '.complete');
  if (existsSync(marker)) return directory;
  for (const source of sources) {
    const outer = await download(source.url, source.sha256);
    const nested = unzipSync(outer)[source.nested];
    if (!nested) throw new Error(`OOXML 标准包缺少 ${source.nested}`);
    const schemas = unzipSync(nested);
    for (const [name, bytes] of Object.entries(schemas)) writeFileSync(join(directory, name), bytes);
  }
  const security = await download(
    'https://repo1.maven.org/maven2/org/apache/poi/ooxml-security/1.1/ooxml-security-1.1.jar',
    'cfa4ef4489724232f59899e330ab7cd02a04345deb56800404ca9ce252491ce5',
  );
  const resources = unzipSync(security);
  for (const name of ['dc.xsd', 'dcterms.xsd']) {
    const part = `schemaorg_apache_xmlbeans/src/${name}`;
    if (!resources[part]) throw new Error(`Dublin Core schema 缺失：${part}`);
    writeFileSync(join(directory, name), resources[part]);
  }
  const xml = await download('https://www.w3.org/2001/xml.xsd', '61960fb3131e38022caad5360e2f33a3382578ab3c80cd58bd74320ede61b20c');
  writeFileSync(join(directory, 'xml.xsd'), xml);
  const core = readFileSync(join(directory, 'opc-coreProperties.xsd'), 'utf8')
    .replace('http://dublincore.org/schemas/xmls/qdc/2003/04/02/dc.xsd', 'dc.xsd')
    .replace('http://dublincore.org/schemas/xmls/qdc/2003/04/02/dcterms.xsd', 'dcterms.xsd');
  writeFileSync(join(directory, 'opc-coreProperties.xsd'), core);
  writeFileSync(marker, new Date().toISOString());
  return directory;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = await prepareOoxmlSchemas();
  console.log(`OOXML schema 已准备到 ${directory}`);
}
