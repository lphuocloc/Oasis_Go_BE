const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const getSwaggerServers = () => {
    const servers = [
        {
            url: 'http://localhost:3000',
            description: 'Development server (Local)'
        }
    ];

    const renderUrl = process.env.RENDER_EXTERNAL_URL?.trim();
    const apiUrl = process.env.API_URL?.trim();
    const ngrokUrl = process.env.NGROK_URL?.trim();
    const seen = new Set(servers.map((server) => server.url));

    const addServer = (url, description) => {
        if (!url || seen.has(url)) return;
        servers.push({ url, description });
        seen.add(url);
    };

    addServer(renderUrl, 'Render deployment');
    addServer(apiUrl, 'Production server');
    addServer(ngrokUrl, 'Development server (ngrok - Public)');

    return servers;
};

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Oasis Go API',
            version: '1.0.0',
            description: 'API documentation for Oasis Go backend with JWT authentication',
            contact: {
                name: 'Oasis Go Team',
                email: 'support@oasisgo.com'
            }
        },
        servers: getSwaggerServers(),
        tags: [
            {
                name: 'Authentication',
                description: 'User authentication endpoints (Register, Login, OTP, Google OAuth)'
            },
            {
                name: 'VNPay Payment',
                description: 'VNPay transaction integration endpoints (Create payment URL, callback, query, refund)'
            },
            {
                name: 'Locations',
                description: 'Location management and hierarchy endpoints'
            },
            {
                name: 'Pod Clusters',
                description: 'Pod cluster management endpoints'
            },
            {
                name: 'Pods',
                description: 'Pod management endpoints with Grid and Single creation modes'
            },
            {
                name: 'SupportRequests',
                description: 'Support request endpoints for users and managers'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Enter your JWT token'
                }
            },
            schemas: {
                User: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'string',
                            description: 'User ID'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            description: 'User email address'
                        },
                        name: {
                            type: 'string',
                            description: 'User full name'
                        },
                        role: {
                            type: 'string',
                            enum: ['user', 'admin', 'manager', 'cleaner'],
                            description: 'User role'
                        },
                        authProvider: {
                            type: 'string',
                            enum: ['local', 'google'],
                            description: 'Authentication provider'
                        },
                        avatar: {
                            type: 'string',
                            nullable: true,
                            description: 'User avatar URL'
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Account creation date'
                        }
                    }
                },
                AuthResponse: {
                    type: 'object',
                    properties: {
                        success: {
                            type: 'boolean'
                        },
                        message: {
                            type: 'string'
                        },
                        data: {
                            type: 'object',
                            properties: {
                                user: {
                                    $ref: '#/components/schemas/User'
                                },
                                token: {
                                    type: 'string',
                                    description: 'JWT access token'
                                }
                            }
                        }
                    }
                },
                Transaction: {
                    type: 'object',
                    properties: {
                        transactionId: {
                            type: 'string',
                            description: 'UUID transaction identifier'
                        },
                        orderId: {
                            type: 'string',
                            description: 'BookingOrder ID used as VNPay order ID'
                        },
                        amount: {
                            type: 'number',
                            description: 'Transaction amount in VND'
                        },
                        currency: {
                            type: 'string',
                            enum: ['VND'],
                            description: 'Currency code'
                        },
                        type: {
                            type: 'string',
                            enum: ['CHARGE', 'REFUND', 'PENALTY'],
                            description: 'Transaction type'
                        },
                        method: {
                            type: 'string',
                            enum: ['VNPAY'],
                            description: 'Transaction method'
                        },
                        status: {
                            type: 'string',
                            enum: ['PENDING', 'SUCCESS', 'FAILED', 'VOIDED'],
                            description: 'Transaction status'
                        },
                        providerReference: {
                            type: 'string',
                            nullable: true,
                            description: 'Provider transaction reference (e.g. VNPay transaction number)'
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Transaction creation date'
                        }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        success: {
                            type: 'boolean',
                            example: false
                        },
                        message: {
                            type: 'string',
                            description: 'Error message'
                        },
                        authProvider: {
                            type: 'string',
                            description: 'Auth provider (if relevant)'
                        }
                    }
                }
            }
        },
        security: [
            {
                bearerAuth: []
            }
        ]
    },
    // Scan all routes and controllers including subfolders
    apis: [
        path.join(__dirname, "../routes/**/*.js"),
        path.join(__dirname, "../controllers/**/*.js"),
    ],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
