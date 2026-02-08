const swaggerJsdoc = require('swagger-jsdoc');

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
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Development server (Local)'
            },
            {
                url: 'https://incongruous-unexpectedly-nia.ngrok-free.dev',
                description: 'Development server (ngrok - Public)'
            },
            {
                url: 'https://api.oasisgo.com',
                description: 'Production server'
            }
        ],
        tags: [
            {
                name: 'Authentication',
                description: 'User authentication endpoints (Register, Login, OTP, Google OAuth)'
            },
            {
                name: 'VNPay Payment',
                description: 'VNPay payment integration endpoints (Create payment, IPN callback, Query payment)'
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
                            enum: ['user', 'admin', 'driver'],
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
                Payment: {
                    type: 'object',
                    properties: {
                        paymentId: {
                            type: 'string',
                            description: 'UUID payment identifier'
                        },
                        bookingId: {
                            type: 'string',
                            description: 'Booking ID reference'
                        },
                        orderId: {
                            type: 'string',
                            description: 'VNPay order ID (unique)'
                        },
                        amount: {
                            type: 'number',
                            description: 'Payment amount in VND'
                        },
                        method: {
                            type: 'string',
                            enum: ['VNPAY', 'CASH', 'BANK_TRANSFER', 'MOMO', 'ZALOPAY'],
                            description: 'Payment method'
                        },
                        status: {
                            type: 'string',
                            enum: ['INITIATED', 'AUTHORIZED', 'FAILED', 'REFUNDED', 'CANCELLED'],
                            description: 'Payment status'
                        },
                        orderInfo: {
                            type: 'string',
                            description: 'Order information/description'
                        },
                        vnpayData: {
                            type: 'object',
                            properties: {
                                transactionNo: {
                                    type: 'string',
                                    description: 'VNPay transaction number'
                                },
                                bankCode: {
                                    type: 'string',
                                    description: 'Bank code used for payment'
                                },
                                responseCode: {
                                    type: 'string',
                                    description: 'VNPay response code'
                                },
                                payDate: {
                                    type: 'string',
                                    description: 'Payment date (yyyyMMddHHmmss)'
                                }
                            }
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Payment creation date'
                        },
                        authorizedAt: {
                            type: 'string',
                            format: 'date-time',
                            nullable: true,
                            description: 'Payment authorization date'
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
    apis: ['./src/routes/*.js'] // Path to API routes
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
