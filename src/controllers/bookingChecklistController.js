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

exports.getReplenishmentRequestItems = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const result = await bookingChecklistService.getReplenishmentRequestItems(
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
      message: error.message || "Error fetching replenishment request items",
    });
  }
};

exports.confirmReplenishmentRequest = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const rawPayload = req.body?.items || req.body;
    const items = parseItemsPayload(rawPayload);
    const result = await bookingChecklistService.confirmReplenishmentRequest(
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
      message: error.message || "Error confirming replenishment request",
    });
  }
};

exports.getReplenishmentRequestStatus = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const result = await bookingChecklistService.getReplenishmentRequestStatus(
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
      message: error.message || "Error fetching replenishment request status",
    });
  }
};

exports.confirmDamageReport = async (req, res) => {
  try {
    const cleanerId = req.user?.id || req.user?._id;
    const rawPayload = req.body?.items || req.body;
    const items = parseItemsPayload(rawPayload);
    const result = await bookingChecklistService.confirmDamageReport(
      req.params.taskId,
      String(cleanerId),
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
      message: error.message || "Error confirming damage report",
    });
  }
};

exports.getDamageReportItems = async (req, res) => {
  try {
    const cleanerId = req.user?.id || req.user?._id;
    const result = await bookingChecklistService.getDamageReportItems(
      req.params.taskId,
      String(cleanerId)
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching damage report items",
    });
  }
};
