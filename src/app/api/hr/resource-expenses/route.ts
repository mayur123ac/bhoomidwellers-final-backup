import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRoles } from "@/lib/serverAuth";
import { getOrganizationId } from "@/lib/tenantContext";

export const dynamic = "force-dynamic";

const VALID_EXPENSE_TYPES = [
  "phone",
  "laptop",
  "furniture",
  "travel",
  "software",
  "other",
];

export async function GET(req: NextRequest) {
  const gate = await requireRoles(["hr", "admin"]);
  if (!gate.ok) return gate.response!;

  try {
    const orgId = await getOrganizationId();
    if (!orgId) {
      return NextResponse.json({ success: false, error: "Organization not found" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const expenseType = searchParams.get("expenseType");
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["re.organization_id = $1"];
    const values: any[] = [orgId];
    let paramIndex = 2;

    if (userId) {
      conditions.push(`re.user_id = $${paramIndex++}`);
      values.push(userId);
    }

    if (expenseType) {
      conditions.push(`re.expense_type = $${paramIndex++}`);
      values.push(expenseType);
    }

    if (status) {
      conditions.push(`re.status = $${paramIndex++}`);
      values.push(status);
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM employee_resource_expenses re WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult[0]?.total ?? "0", 10);

    const dataResult = await query<any>(
      `SELECT re.*,
              u.name AS employee_name,
              u.email AS employee_email
       FROM employee_resource_expenses re
       LEFT JOIN users u ON u.id = re.user_id
       WHERE ${whereClause}
       ORDER BY re.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, limit, offset]
    );

    return NextResponse.json({
      success: true,
      data: {
        records: dataResult.map((r: any) => ({
          id: r.id,
          userId: r.user_id,
          employeeName: r.employee_name || "—",
          expenseType: r.expense_type,
          description: r.description,
          purchaseDate: r.purchase_date,
          purchaseCost: Number(r.purchase_cost),
          allocationMethod: r.allocation_method,
          allocationMonths: r.allocation_months,
          monthlyAmount: Number(r.monthly_amount),
          allocationStart: r.allocation_start,
          allocationEnd: r.allocation_end,
          isCompanyExpense: r.is_company_expense,
          status: r.status,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error("GET /api/hr/resource-expenses error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireRoles(["admin"]);
  if (!gate.ok) return gate.response!;

  try {
    const orgId = await getOrganizationId();
    if (!orgId) {
      return NextResponse.json({ success: false, error: "Organization not found" }, { status: 403 });
    }

    const body = await req.json();
    const {
      userId,
      expenseType,
      description,
      purchaseDate,
      purchaseCost,
      allocationMethod,
      allocationMonths,
      isCompanyExpense,
    } = body;

    if (!userId || !expenseType || !purchaseDate || purchaseCost === undefined || !allocationMethod) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: userId, expenseType, purchaseDate, purchaseCost, allocationMethod" },
        { status: 400 }
      );
    }

    const cost = parseFloat(purchaseCost);
    if (isNaN(cost) || cost <= 0) {
      return NextResponse.json({ success: false, error: "purchaseCost must be greater than 0" }, { status: 400 });
    }

    if (!VALID_EXPENSE_TYPES.includes(expenseType)) {
      return NextResponse.json(
        { success: false, error: `Invalid expenseType. Must be one of: ${VALID_EXPENSE_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    if (allocationMethod !== "one_time" && allocationMethod !== "monthly") {
      return NextResponse.json(
        { success: false, error: "allocationMethod must be 'monthly' or 'one_time'" },
        { status: 400 }
      );
    }

    let monthlyAmount: number;
    let months = 1;
    let allocationStart: string = purchaseDate;
    let allocationEnd: string | null = null;

    if (allocationMethod === "monthly") {
      months = parseInt(allocationMonths, 10);
      if (isNaN(months) || months < 1) {
        return NextResponse.json({ success: false, error: "allocationMonths must be at least 1" }, { status: 400 });
      }
      monthlyAmount = cost / months;
      const endDate = new Date(purchaseDate);
      endDate.setMonth(endDate.getMonth() + months);
      allocationEnd = endDate.toISOString().split("T")[0];
    } else {
      monthlyAmount = cost;
    }

    const result = await query<any>(
      `INSERT INTO employee_resource_expenses (
        organization_id, user_id, expense_type, description,
        purchase_date, purchase_cost, allocation_method, allocation_months,
        monthly_amount, allocation_start, allocation_end,
        is_company_expense, status, created_by
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11,
        $12, 'active', $13
      ) RETURNING *`,
      [
        orgId,
        userId,
        expenseType,
        description || "",
        purchaseDate,
        cost,
        allocationMethod,
        months,
        monthlyAmount,
        allocationStart,
        allocationEnd,
        isCompanyExpense ?? true,
        gate.userId,
      ]
    );

    return NextResponse.json({ success: true, data: result[0] }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/hr/resource-expenses error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
