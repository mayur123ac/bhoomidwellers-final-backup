import { NextResponse } from "next/server";
import { getUpdatesWithReadStatus, markUpdateAsRead, createCrmUpdate } from "@/lib/crmUpdates";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userIdParam = searchParams.get("userId");

    // We assume userId comes from the client since auth is client-side in localStorage
    if (!userIdParam) {
      return NextResponse.json({ message: "userId is required" }, { status: 400 });
    }

    const userId = parseInt(userIdParam, 10);
    const updates = await getUpdatesWithReadStatus(userId);

    return NextResponse.json({ success: true, data: updates }, { status: 200 });
  } catch (error) {
    console.error("GET UPDATES ERROR:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch updates" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // If the request is to mark an update as read
    if (body.action === "mark_read") {
      const { userId, updateId } = body;
      
      if (!userId || !updateId) {
        return NextResponse.json({ message: "userId and updateId required" }, { status: 400 });
      }

      await markUpdateAsRead(parseInt(userId, 10), parseInt(updateId, 10));
      return NextResponse.json({ success: true }, { status: 200 });
    }

    // (Optional) Admin route to create an update from the UI
    if (body.action === "create") {
      const { version, title, description, category, features, is_important, created_by } = body;
      const newUpdate = await createCrmUpdate({
        version, title, description, category, features, is_important, created_by
      });
      return NextResponse.json({ success: true, data: newUpdate }, { status: 201 });
    }

    return NextResponse.json({ message: "Invalid action" }, { status: 400 });

  } catch (error) {
    console.error("POST UPDATES ERROR:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process update action" },
      { status: 500 }
    );
  }
}

import { updateCrmUpdate, deleteCrmUpdate } from "@/lib/crmUpdates";

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, version, title, description, category, features, is_important } = body;
    
    if (!id) {
      return NextResponse.json({ message: "Update ID required" }, { status: 400 });
    }

    const updatedUpdate = await updateCrmUpdate(parseInt(id, 10), {
      version, title, description, category, features, is_important
    });

    return NextResponse.json({ success: true, data: updatedUpdate }, { status: 200 });
  } catch (error) {
    console.error("PUT UPDATES ERROR:", error);
    return NextResponse.json(
      { success: false, message: "Failed to update" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id");

    if (!idParam) {
      return NextResponse.json({ message: "Update ID required" }, { status: 400 });
    }

    const deleted = await deleteCrmUpdate(parseInt(idParam, 10));
    if (!deleted) {
      return NextResponse.json({ success: false, message: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE UPDATES ERROR:", error);
    return NextResponse.json(
      { success: false, message: "Failed to delete" },
      { status: 500 }
    );
  }
}
