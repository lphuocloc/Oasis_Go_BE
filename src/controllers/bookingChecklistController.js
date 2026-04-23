const bookingChecklistService = require("../services/bookingChecklistService");

const parseItemsPayload = (raw) => {
  if (Array.isArray(raw)) return raw;

  if (raw && typeof raw === "object" && Array.isArray(raw.items)) {
    return raw.items;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      // Handle case where user pastes {"items": [...]} into Swagger
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
        return parsed.items;
      }
    } catch (_) {
      // Fall through
    }
  }

  return [];
};

exports.getChecklistItems = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const result = await bookingChecklistService.getChecklistItems(
      req.params.id,
      String(userId)
    );
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching checklist items",
    });
  }
};

exports.confirmChecklist = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const rawPayload = req.body?.items || req.body;
    const items = parseItemsPayload(rawPayload);
    const result = await bookingChecklistService.confirmChecklist(
      req.params.id,
      String(userId),
      items
    );

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error confirming checklist",
    });
  }
};

exports.getChecklistStatus = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const result = await bookingChecklistService.getChecklistStatus(
      req.params.id,
      String(userId)
    );
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching checklist status",
    });
  }
};
