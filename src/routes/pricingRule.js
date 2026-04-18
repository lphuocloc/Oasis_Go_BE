const express = require("express");
const router = express.Router();
const pricingRuleController = require("../controllers/pricingRuleController");
const { protect, authorize } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * components:
 *   schemas:
 *     PricingRule:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 5fd0a8c0-0d3f-4cdf-8f97-534b89e2a3b1
 *         location_id:
 *           type: string
 *           nullable: true
 *           example: 0e54c1e0-413e-4f9d-b2a5-f92bf2aaf0f5
 *         start_time:
 *           type: string
 *           description: UTC time in HH:mm or HH:mm:ss
 *           example: "08:00:00"
 *         end_time:
 *           type: string
 *           description: UTC time in HH:mm or HH:mm:ss
 *           example: "11:00:00"
 *         days_of_week:
 *           type: array
 *           items:
 *             type: string
 *             enum: [MON, TUE, WED, THU, FRI, SAT, SUN]
 *           example: [MON, TUE, WED]
 *         multiplier:
 *           type: number
 *           example: 1.2
 *         price_modifier:
 *           type: number
 *           description: Backward compatibility alias for multiplier
 *           example: 1.2
 *         is_active:
 *           type: boolean
 *           example: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: 2026-04-10T07:00:00.000Z
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: 2026-04-10T07:00:00.000Z
 *
 *     PricingRuleCreateRequest:
 *       type: object
 *       required:
 *         - start_time
 *         - end_time
 *         - days_of_week
 *         - multiplier
 *       properties:
 *         location_id:
 *           type: string
 *           nullable: true
 *           description: Location scope for single-create mode
 *         location_ids:
 *           type: array
 *           description: Bulk-create mode. Create one rule per location_id.
 *           items:
 *             type: string
 *           example: [loc-1, loc-2, loc-3]
 *         start_time:
 *           type: string
 *           example: "08:00"
 *         end_time:
 *           type: string
 *           example: "11:00"
 *         days_of_week:
 *           type: array
 *           items:
 *             type: string
 *             enum: [MON, TUE, WED, THU, FRI, SAT, SUN]
 *           example: [MON, TUE, WED]
 *         multiplier:
 *           type: number
 *           example: 1.2
 *         price_modifier:
 *           type: number
 *           description: Backward compatibility alias for multiplier
 *           example: 1.2
 *         is_active:
 *           type: boolean
 *           default: true
 *
 *     PricingRuleUpdateRequest:
 *       type: object
 *       description: Partial update payload
 *       properties:
 *         location_id:
 *           type: string
 *           nullable: true
 *         start_time:
 *           type: string
 *           example: "13:00"
 *         end_time:
 *           type: string
 *           example: "17:00"
 *         days_of_week:
 *           type: array
 *           items:
 *             type: string
 *             enum: [MON, TUE, WED, THU, FRI, SAT, SUN]
 *         multiplier:
 *           type: number
 *           example: 1.35
 *         price_modifier:
 *           type: number
 *           description: Backward compatibility alias for multiplier
 *           example: 1.35
 *         is_active:
 *           type: boolean
 *
 *     PricingRuleListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Pricing rules listed successfully
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PricingRule'
 *         pagination:
 *           type: object
 *           nullable: true
 *           properties:
 *             current_page:
 *               type: integer
 *               example: 1
 *             total_pages:
 *               type: integer
 *               example: 5
 *             total_items:
 *               type: integer
 *               example: 92
 *             items_per_page:
 *               type: integer
 *               example: 20
 *
 *     PricingRuleSingleResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Pricing rule created successfully
 *         data:
 *           $ref: '#/components/schemas/PricingRule'
 *
 *     PricingRuleQueryResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Pricing rules retrieved successfully
 *         count:
 *           type: integer
 *           example: 2
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PricingRule'
 *
 *     PricingRuleErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: Pricing rule not found
 *
 *     PricingRuleQuoteResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Provisional quote calculated successfully
 *         data:
 *           type: object
 *           properties:
 *             requested_at_utc:
 *               type: string
 *               format: date-time
 *               example: 2026-04-10T09:30:00.000Z
 *             start_at_utc:
 *               type: string
 *               format: date-time
 *               nullable: true
 *             end_at_utc:
 *               type: string
 *               format: date-time
 *               nullable: true
 *             duration_hours:
 *               type: number
 *               nullable: true
 *             pod_count:
 *               type: integer
 *               nullable: true
 *             base_amount_per_hour:
 *               type: number
 *               nullable: true
 *             amount_per_pod:
 *               type: number
 *               nullable: true
 *             base_amount:
 *               type: number
 *               nullable: true
 *               example: 200000
 *             applied_modifier:
 *               type: number
 *               nullable: true
 *               example: 1.2
 *             final_amount:
 *               type: number
 *               example: 240000
 *             segments:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   start_at_utc:
 *                     type: string
 *                     format: date-time
 *                   end_at_utc:
 *                     type: string
 *                     format: date-time
 *                   duration_hours:
 *                     type: number
 *                   applied_multiplier:
 *                     type: number
 *                   pricing_rule_id:
 *                     type: string
 *                     nullable: true
 *                   amount:
 *                     type: number
 *             effective_rule:
 *               type: object
 *               nullable: true
 *               properties:
 *                 id:
 *                   type: string
 *                 scope:
 *                   type: string
 *                   enum: [LOCATION]
 *                 multiplier:
 *                   type: number
 *             matched_rules:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   scope:
 *                     type: string
 *                     enum: [LOCATION]
 *                   multiplier:
 *                     type: number
 *                   is_applied:
 *                     type: boolean
 *                   reason:
 *                     type: string
 *
 * tags:
 *   name: PricingRules
 *   description: Query effective pricing rules by scope and UTC datetime
 */

/**
 * @swagger
 * /api/pricing-rules:
 *   get:
 *     summary: List pricing rules for management
 *     tags: [PricingRules]
 *     parameters:
 *       - in: query
 *         name: location_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: is_active
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pricing rules listed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleListResponse'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleErrorResponse'
 *   post:
 *     summary: Create a pricing rule
 *     tags: [PricingRules]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PricingRuleCreateRequest'
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Pricing rule created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleSingleResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleErrorResponse'
 */
router.get("/", protect, authorize("admin", "manager"), pricingRuleController.listPricingRules);
router.post("/", protect, authorize("admin", "manager"), pricingRuleController.createPricingRule);

/**
 * @swagger
 * /api/pricing-rules/{id}:
 *   put:
 *     summary: Update a pricing rule
 *     tags: [PricingRules]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PricingRuleUpdateRequest'
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pricing rule updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleSingleResponse'
 *       404:
 *         description: Pricing rule not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleErrorResponse'
 *   delete:
 *     summary: Soft delete a pricing rule (set is_active=false)
 *     tags: [PricingRules]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pricing rule deactivated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleSingleResponse'
 *       404:
 *         description: Pricing rule not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleErrorResponse'
 */
router.put("/:id", protect, authorize("admin", "manager"), pricingRuleController.updatePricingRule);
router.delete("/:id", protect, authorize("admin", "manager"), pricingRuleController.deletePricingRule);

/**
 * @swagger
 * /api/pricing-rules/effective:
 *   get:
 *     summary: Get highest-precedence effective pricing rule
 *     tags: [PricingRules]
 *     parameters:
 *       - in: query
 *         name: location_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: at
 *         description: UTC datetime (ISO-8601)
 *         schema:
 *           type: string
 *           format: date-time
 *           example: 2026-04-10T09:30:00Z
 *       - in: query
 *         name: include_inactive
 *         schema:
 *           type: boolean
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Effective pricing rule retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleSingleResponse'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleErrorResponse'
 */
router.get("/effective", protect, authorize("admin", "manager"), pricingRuleController.getEffectiveRule);

/**
 * @swagger
 * /api/pricing-rules/quote:
 *   get:
 *     summary: Get simplified provisional quote for FE display
 *     tags: [PricingRules]
 *     parameters:
 *       - in: query
 *         name: cluster_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: location_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: at
 *         description: UTC datetime (ISO-8601). Defaults to now.
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: start_at
 *         description: UTC datetime (ISO-8601) for interval quote mode.
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: end_at
 *         description: UTC datetime (ISO-8601) for interval quote mode.
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: pod_count
 *         description: Optional multiplier for total quote in interval mode. Defaults to 1.
 *         schema:
 *           type: integer
 *           minimum: 1
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Provisional quote calculated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleQuoteResponse'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PricingRuleErrorResponse'
 */
router.get("/quote", protect, pricingRuleController.getProvisionalQuote);

module.exports = router;
