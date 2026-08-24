"use client";

/**
 * The front-desk dashboard's donut chart, used by both the Configuration and
 * Lead Sources cards.
 *
 * PERF: recharts is ~8 MB in node_modules and was imported STATICALLY at the top
 * of the receptionist page, so it sat in that route's initial JavaScript and had
 * to be parsed before first paint — including for the front-desk staff who spend
 * the whole day on the enquiry queue and never scroll to a chart. Living in its
 * own module lets the page reach it through next/dynamic.
 *
 * Both call sites rendered byte-identical markup around different data, so they
 * collapse into one component. `tooltip` is passed in as an element because the
 * page's CustomTooltip closes over its theme object; recharts requires it to be
 * the direct `content` of <Tooltip>, which it still is.
 */

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { ReactElement } from "react";

export default function ReceptionistDonutChart({
  data, legendColor, tooltip,
}: { data: any[]; legendColor: string; tooltip: ReactElement }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none">
          {data.map((_: any, i: number) => <Cell key={i} fill={data[i].color} />)}
        </Pie>
        <Tooltip content={tooltip} />
        <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: "10px", color: legendColor, paddingTop: "10px" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
