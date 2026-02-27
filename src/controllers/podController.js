const Pod = require("../models/Pod");
const PodCluster = require("../models/PodCluster");

/**
 * Helper function to generate row letter from index
 * 0 -> A, 1 -> B, ..., 25 -> Z, 26 -> AA, 27 -> AB, etc.
 */
const getRowLetter = (index) => {
    let letter = "";
    while (index >= 0) {
        letter = String.fromCharCode(65 + (index % 26)) + letter;
        index = Math.floor(index / 26) - 1;
    }
    return letter;
};

/**
 * Helper function to generate pod code
 * Format: [RowLetter][ColNumber][Level]
 * Example: A01L, A01U, B05L, B05U
 */
const generatePodCode = (rowIndex, colIndex, level) => {
    const rowLetter = getRowLetter(rowIndex);
    const colNumber = String(colIndex + 1).padStart(2, "0");
    return `${rowLetter}${colNumber}${level}`;
};

/**
 * @desc    Create pods (Grid or Single mode)
 * @route   POST /api/pods/create
 * @access  Private (Admin/Manager)
 */
exports.createPods = async (req, res) => {
    try {
        const {
            cluster_id,
            numRows,
            numCols,
            code,
            name,
            description,
            soundproof_level,
            ventilation_level,
            power_outlets,
            wifi_available,
            max_session_duration,
        } = req.body;

        // Validate cluster_id
        if (!cluster_id) {
            return res.status(400).json({
                success: false,
                message: "Cluster ID is required",
            });
        }

        // Validate cluster exists
        const cluster = await PodCluster.findOne({ id: cluster_id });
        if (!cluster) {
            return res.status(404).json({
                success: false,
                message: "Pod cluster not found",
            });
        }

        // Default values for pod amenities
        const defaultValues = {
            soundproof_level: soundproof_level || 3,
            ventilation_level: ventilation_level || 3,
            power_outlets: power_outlets || 2,
            wifi_available: wifi_available !== undefined ? wifi_available : true,
            max_session_duration: max_session_duration || 480,
            status: "AVAILABLE",
        };

        let podsToCreate = [];

        // Constants for Grid limitations
        const MAX_ROWS = 10;
        const MAX_COLS = 20;
        const MAX_TOTAL_PODS = 200;

        // MODE 1: Grid Creation
        if (numRows && numCols) {
            if (numRows <= 0 || numCols <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Number of rows and columns must be positive integers",
                });
            }

            // Validate max rows and columns
            if (numRows > MAX_ROWS) {
                return res.status(400).json({
                    success: false,
                    message: `Number of rows cannot exceed ${MAX_ROWS}`,
                });
            }

            if (numCols > MAX_COLS) {
                return res.status(400).json({
                    success: false,
                    message: `Number of columns cannot exceed ${MAX_COLS}`,
                });
            }

            // Calculate total pods (each position has 2 levels: L and U)
            const totalPods = numRows * numCols * 2;

            if (totalPods > MAX_TOTAL_PODS) {
                return res.status(400).json({
                    success: false,
                    message: `Total pods (${totalPods}) would exceed maximum limit of ${MAX_TOTAL_PODS}. Please reduce rows or columns.`,
                    calculated: {
                        numRows,
                        numCols,
                        totalPods,
                        maxAllowed: MAX_TOTAL_PODS,
                    },
                });
            }

            // Generate pods for grid layout
            for (let row = 0; row < numRows; row++) {
                for (let col = 0; col < numCols; col++) {
                    // Each column has 2 levels: Lower (L) and Upper (U)
                    const levels = ["L", "U"];

                    for (const level of levels) {
                        const podCode = generatePodCode(row, col, level);
                        const podName = name
                            ? `${name} - ${podCode}`
                            : `Pod ${podCode}`;

                        podsToCreate.push({
                            cluster_id,
                            code: podCode,
                            name: podName,
                            description: description || `Grid pod at position ${podCode}`,
                            ...defaultValues,
                        });
                    }
                }
            }

            console.log(`Creating ${totalPods} pods in ${numRows}x${numCols} grid (2 levels each)`);
        }
        // MODE 2: Single Pod Creation
        else if (code) {
            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: "Pod name is required for single pod creation",
                });
            }

            podsToCreate.push({
                cluster_id,
                code: code.toUpperCase(),
                name,
                description: description || null,
                ...defaultValues,
            });
        }
        // Invalid mode
        else {
            return res.status(400).json({
                success: false,
                message: "Either provide (numRows and numCols) for grid creation, or (code and name) for single pod creation",
            });
        }

        // Insert pods using insertMany for performance
        try {
            const createdPods = await Pod.insertMany(podsToCreate, { ordered: false });

            res.status(201).json({
                success: true,
                message: `Successfully created ${createdPods.length} pod(s)`,
                count: createdPods.length,
                data: createdPods,
            });
        } catch (error) {
            // Handle duplicate key error (code 11000)
            if (error.code === 11000) {
                const duplicateKeys = error.writeErrors
                    ? error.writeErrors.map((e) => e.err.op.code)
                    : [];

                return res.status(409).json({
                    success: false,
                    message: "Some pods already exist in this cluster",
                    duplicates: duplicateKeys,
                    inserted: error.result?.nInserted || 0,
                });
            }

            throw error;
        }
    } catch (error) {
        console.error("Error creating pods:", error);
        res.status(500).json({
            success: false,
            message: "Error creating pods",
            error: error.message,
        });
    }
};

/**
 * @desc    Get all pods
 * @route   GET /api/pods
 * @access  Public
 */
exports.getAllPods = async (req, res) => {
    try {
        const { cluster_id, status } = req.query;
        const filter = {};

        if (cluster_id) filter.cluster_id = cluster_id;
        if (status) filter.status = status;

        const pods = await Pod.find(filter)
            .populate("cluster")
            .sort({ code: 1 });

        res.status(200).json({
            success: true,
            count: pods.length,
            data: pods,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching pods",
            error: error.message,
        });
    }
};

/**
 * @desc    Get pod by ID
 * @route   GET /api/pods/:id
 * @access  Public
 */
exports.getPodById = async (req, res) => {
    try {
        const pod = await Pod.findOne({ id: req.params.id }).populate("cluster");

        if (!pod) {
            return res.status(404).json({
                success: false,
                message: "Pod not found",
            });
        }

        res.status(200).json({
            success: true,
            data: pod,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching pod",
            error: error.message,
        });
    }
};

/**
 * @desc    Get pods by cluster
 * @route   GET /api/pods/cluster/:clusterId
 * @access  Public
 */
exports.getPodsByCluster = async (req, res) => {
    try {
        const pods = await Pod.getByCluster(req.params.clusterId);

        res.status(200).json({
            success: true,
            count: pods.length,
            data: pods,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching pods by cluster",
            error: error.message,
        });
    }
};

/**
 * @desc    Get available pods
 * @route   GET /api/pods/available
 * @access  Public
 */
exports.getAvailablePods = async (req, res) => {
    try {
        const { cluster_id } = req.query;
        const pods = await Pod.getAvailable(cluster_id || null);

        res.status(200).json({
            success: true,
            count: pods.length,
            data: pods,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching available pods",
            error: error.message,
        });
    }
};

/**
 * @desc    Update pod
 * @route   PUT /api/pods/:id
 * @access  Private (Admin/Manager)
 */
exports.updatePod = async (req, res) => {
    try {
        const {
            name,
            description,
            status,
            maintenance_status,
            soundproof_level,
            ventilation_level,
            power_outlets,
            wifi_available,
            max_session_duration,
        } = req.body;

        const pod = await Pod.findOne({ id: req.params.id });

        if (!pod) {
            return res.status(404).json({
                success: false,
                message: "Pod not found",
            });
        }

        // Update fields
        if (name !== undefined) pod.name = name;
        if (description !== undefined) pod.description = description;
        if (status !== undefined) pod.status = status;
        if (maintenance_status !== undefined) pod.maintenance_status = maintenance_status;
        if (soundproof_level !== undefined) pod.soundproof_level = soundproof_level;
        if (ventilation_level !== undefined) pod.ventilation_level = ventilation_level;
        if (power_outlets !== undefined) pod.power_outlets = power_outlets;
        if (wifi_available !== undefined) pod.wifi_available = wifi_available;
        if (max_session_duration !== undefined) pod.max_session_duration = max_session_duration;

        await pod.save();
        await pod.populate("cluster");

        res.status(200).json({
            success: true,
            message: "Pod updated successfully",
            data: pod,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error updating pod",
            error: error.message,
        });
    }
};

/**
 * @desc    Delete pod
 * @route   DELETE /api/pods/:id
 * @access  Private (Admin/Manager)
 */
exports.deletePod = async (req, res) => {
    try {
        const pod = await Pod.findOne({ id: req.params.id });

        if (!pod) {
            return res.status(404).json({
                success: false,
                message: "Pod not found",
            });
        }

        // Check if pod is occupied
        if (pod.status === "OCCUPIED") {
            return res.status(400).json({
                success: false,
                message: "Cannot delete occupied pod",
            });
        }

        await Pod.deleteOne({ id: req.params.id });

        res.status(200).json({
            success: true,
            message: "Pod deleted successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error deleting pod",
            error: error.message,
        });
    }
};

/**
 * @desc    Update pod status
 * @route   PATCH /api/pods/:id/status
 * @access  Private (Admin/Manager/Cleaner)
 */
exports.updatePodStatus = async (req, res) => {
    try {
        const { status, maintenance_status } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: "Status is required",
            });
        }

        const pod = await Pod.findOne({ id: req.params.id });

        if (!pod) {
            return res.status(404).json({
                success: false,
                message: "Pod not found",
            });
        }

        // Use helper methods for status transitions
        try {
            switch (status) {
                case "OCCUPIED":
                    await pod.markAsOccupied();
                    break;
                case "AVAILABLE":
                    await pod.markAsAvailable();
                    break;
                case "NEEDS_CLEANING":
                    await pod.markAsNeedsCleaning();
                    break;
                case "CLEANING":
                    await pod.startCleaning();
                    break;
                case "MAINTENANCE":
                    await pod.markForMaintenance(maintenance_status);
                    break;
                default:
                    pod.status = status;
                    await pod.save();
            }

            await pod.populate("cluster");

            res.status(200).json({
                success: true,
                message: "Pod status updated successfully",
                data: pod,
            });
        } catch (statusError) {
            return res.status(400).json({
                success: false,
                message: statusError.message,
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error updating pod status",
            error: error.message,
        });
    }
};

/**
 * @desc    Complete pod cleaning
 * @route   PATCH /api/pods/:id/complete-cleaning
 * @access  Private (Admin/Manager/Cleaner)
 */
exports.completePodCleaning = async (req, res) => {
    try {
        const pod = await Pod.findOne({ id: req.params.id });

        if (!pod) {
            return res.status(404).json({
                success: false,
                message: "Pod not found",
            });
        }

        await pod.completeCleaning();
        await pod.populate("cluster");

        res.status(200).json({
            success: true,
            message: "Pod cleaning completed successfully",
            data: pod,
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};
