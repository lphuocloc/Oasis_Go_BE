const StaffShiftAssignment = require("../models/StaffShiftAssignment");
const StaffWorkRoster = require("../models/StaffWorkRoster");
const LocationShift = require("../models/LocationShift");
const Location = require("../models/Location");
const PodCluster = require("../models/PodCluster");
const Pod = require("../models/Pod");

const ACTIVE_SCOPE_STATUSES = ["ASSIGNED", "CHECKED_IN"];

const getRequestValue = (req, source, key) => {
  if (!source || !key) return undefined;
  const container = req[source] || {};
  return container[key];
};

const uniqueStrings = (values) => [...new Set(values.filter(Boolean).map((v) => String(v)))];

const loadManagerScope = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "manager") {
      return next();
    }

    if (req.managerScope) {
      return next();
    }

    const staffIds = uniqueStrings([req.user.id, req.user._id]);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    const [assignments, rosters] = await Promise.all([
      StaffShiftAssignment.find({
        staff_id: { $in: staffIds },
        status: { $in: ACTIVE_SCOPE_STATUSES },
        start_date: { $lte: todayEnd },
        end_date: { $gte: todayStart },
      })
        .select("location_shift_id")
        .lean(),
      StaffWorkRoster.find({
        staff_id: { $in: staffIds },
        is_active: true
      })
        .select("location_shift_id")
        .lean()
    ]);

    const assignmentLocShiftIds = assignments.map((item) => item.location_shift_id);
    const rosterLocShiftIds = rosters.map((item) => item.location_shift_id);
    const uniqueLocShiftIds = uniqueStrings([...assignmentLocShiftIds, ...rosterLocShiftIds]);

    if (uniqueLocShiftIds.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Manager has no assigned location scope",
      });
    }

    const locationShifts = await LocationShift.find({ id: { $in: uniqueLocShiftIds } })
      .select("location_id")
      .lean();

    const parentLocationIds = uniqueStrings(locationShifts.map((item) => item.location_id));

    if (parentLocationIds.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Manager has no assigned parent location scope",
      });
    }

    const descendantsByParent = await Promise.all(
      parentLocationIds.map((locationId) => Location.getDescendants(locationId))
    );

    const descendantLocationIds = descendantsByParent.flat().map((item) => item.id);
    const locationIds = uniqueStrings([...parentLocationIds, ...descendantLocationIds]);

    const clusters = await PodCluster.find({ location_id: { $in: locationIds } })
      .select("id")
      .lean();
    const clusterIds = uniqueStrings(clusters.map((item) => item.id));

    let podIds = [];
    if (clusterIds.length > 0) {
      const pods = await Pod.find({ cluster_id: { $in: clusterIds } })
        .select("id")
        .lean();
      podIds = uniqueStrings(pods.map((item) => item.id));
    }

    req.managerScope = {
      parentLocationIds,
      locationIds,
      clusterIds,
      podIds,
    };

    next();
  } catch (error) {
    next(error);
  }
};

const requireManagerLocationAccess = ({ source = "params", key = "locationId" } = {}) => {
  return (req, res, next) => {
    if (!req.user || req.user.role !== "manager") {
      return next();
    }

    const locationId = getRequestValue(req, source, key);
    if (!locationId) {
      return next();
    }

    if (!req.managerScope || !req.managerScope.locationIds.includes(String(locationId))) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this location",
      });
    }

    next();
  };
};

const requireManagerClusterAccess = ({ source = "params", key = "id" } = {}) => {
  return (req, res, next) => {
    if (!req.user || req.user.role !== "manager") {
      return next();
    }

    const clusterId = getRequestValue(req, source, key);
    if (!clusterId) {
      return next();
    }

    if (!req.managerScope || !req.managerScope.clusterIds.includes(String(clusterId))) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this pod cluster",
      });
    }

    next();
  };
};

const requireManagerPodAccess = ({ source = "params", key = "podId" } = {}) => {
  return (req, res, next) => {
    if (!req.user || req.user.role !== "manager") {
      return next();
    }

    const podId = getRequestValue(req, source, key);
    if (!podId) {
      return next();
    }

    if (!req.managerScope || !req.managerScope.podIds.includes(String(podId))) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to access this pod",
      });
    }

    next();
  };
};

const applyManagerBookingScope = (req, res, next) => {
  if (!req.user || req.user.role !== "manager") {
    return next();
  }

  const scopedPodIds = (req.managerScope && req.managerScope.podIds) || [];
  let requestedIds = [];
  
  if (req.query.pod_ids) {
    requestedIds = String(req.query.pod_ids).split(",");
  } else if (req.query.pod_id) {
    requestedIds = [String(req.query.pod_id)];
  }

  if (requestedIds.length > 0) {
    const intersection = requestedIds.filter(id => scopedPodIds.includes(id));
    req.query.pod_ids = intersection.join(",");
  } else {
    req.query.pod_ids = scopedPodIds.join(",");
  }

  delete req.query.pod_id;

  next();
};

const applyManagerLocationScope = (req, res, next) => {
  if (!req.user || req.user.role !== "manager") {
    return next();
  }

  const scopedLocationIds = (req.managerScope && req.managerScope.locationIds) || [];
  if (req.query.scope_location_ids) {
    const requestedIds = String(req.query.scope_location_ids).split(",");
    const intersection = requestedIds.filter(id => scopedLocationIds.includes(id));
    req.query.scope_location_ids = intersection.join(",");
  } else {
    req.query.scope_location_ids = scopedLocationIds.join(",");
  }
  next();
};

const applyManagerPodScope = (req, res, next) => {
  if (!req.user || req.user.role !== "manager") {
    return next();
  }

  const scopedPodIds = (req.managerScope && req.managerScope.podIds) || [];
  if (req.query.pod_ids) {
    const requestedIds = String(req.query.pod_ids).split(",");
    const intersection = requestedIds.filter(id => scopedPodIds.includes(id));
    req.query.pod_ids = intersection.join(",");
  } else {
    req.query.pod_ids = scopedPodIds.join(",");
  }
  next();
};

module.exports = {
  loadManagerScope,
  requireManagerLocationAccess,
  requireManagerClusterAccess,
  requireManagerPodAccess,
  applyManagerBookingScope,
  applyManagerLocationScope,
  applyManagerPodScope,
};
