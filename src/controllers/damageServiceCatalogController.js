const damageServiceCatalogService = require("../services/damageServiceCatalogService");

exports.createDamageServiceCatalog = async (req, res) => {
  try {
    const catalog = await damageServiceCatalogService.createDamageServiceCatalog(req.body);
    res.status(201).json({
      success: true,
      message: "Damage service catalog created successfully",
      data: catalog,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error creating damage service catalog",
    });
  }
};

exports.getAllDamageServiceCatalogs = async (req, res) => {
  try {
    const catalogs = await damageServiceCatalogService.getAllDamageServiceCatalogs(req.query);
    res.status(200).json({
      success: true,
      count: catalogs.length,
      data: catalogs,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching damage service catalogs",
    });
  }
};

exports.getDamageServiceCatalogById = async (req, res) => {
  try {
    const catalog = await damageServiceCatalogService.getDamageServiceCatalogById(req.params.id);
    res.status(200).json({
      success: true,
      data: catalog,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error fetching damage service catalog",
    });
  }
};

exports.updateDamageServiceCatalog = async (req, res) => {
  try {
    const catalog = await damageServiceCatalogService.updateDamageServiceCatalog(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: "Damage service catalog updated successfully",
      data: catalog,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error updating damage service catalog",
    });
  }
};

exports.deleteDamageServiceCatalog = async (req, res) => {
  try {
    const result = await damageServiceCatalogService.deleteDamageServiceCatalog(req.params.id);
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || "Error deleting damage service catalog",
    });
  }
};
