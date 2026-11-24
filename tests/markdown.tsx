import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../components/canvas/agent-messages";

const html = renderToStaticMarkup(
  <Markdown>{`**重点**

- 列表项目

---

| 名称 | 数量 |
| --- | --- |
| 图片 | 2 |

\`\`\`js
const safe = true;
\`\`\`

<script>alert(1)</script>
<img src=x onerror=alert(1)>

[危险](javascript:alert(1))
[编码危险](java&#x73;cript:alert(1))
[协议相对地址](//example.invalid)
[安全链接](https://example.com)
![外部追踪图](https://example.invalid/pixel.png)
`}</Markdown>,
);
for (const tag of ["strong", "ul", "li", "hr", "table", "pre", "code"])
  assert(html.includes(`<${tag}`), `Missing ${tag}`);
assert(!/<script|<img|onerror=|href="javascript:|href="\/\//i.test(html));
assert(html.includes('href="https://example.com"'));
assert(html.includes('rel="noopener noreferrer"'));
console.log(
  "PASS Markdown bold/list/rule/table/code; HTML, unsafe schemes and tracking images blocked",
);
