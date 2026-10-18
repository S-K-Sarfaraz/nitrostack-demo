import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '@prisma/client';
import { ToolDecorator as Tool, ExecutionContext, z } from '@nitrostack/core';

// Initialize a connection pool and Prisma driver adapter for PostgreSQL
const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgrespassword@localhost:5432/indian_ecommerce_db?schema=public';

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

/**
 * Zod validation schema for searching Indian e-commerce users
 */
export const SearchEcommerceUsersSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Filter users by full or partial name (case-insensitive, e.g. "Aarav", "Priya", "Patel")'),
  city: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Filter users by Indian city (e.g. "Bengaluru", "Mumbai", "New Delhi", "Pune", "Kolkata")'),
  min_total_orders: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Filter users who have placed at least this many orders'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of user records to return (1-100, default: 20)'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe('Number of user records to skip for pagination (default: 0)'),
});

export type SearchEcommerceUsersInput = z.infer<typeof SearchEcommerceUsersSchema>;

/**
 * Tool controller for querying e-commerce user profiles from PostgreSQL
 */
export class EcommerceUserTools {
  /**
   * Search and filter seeded Indian e-commerce users from the local PostgreSQL database
   */
  @Tool({
    name: 'search_ecommerce_users',
    description:
      'Search and filter 1,000 seeded Indian e-commerce user records by full name, city, and minimum total order count with pagination support.',
    inputSchema: SearchEcommerceUsersSchema,
    examples: {
      request: {
        city: 'Bengaluru',
        min_total_orders: 15,
        limit: 5,
        offset: 0,
      },
      response: {
        success: true,
        match_count: 5,
        total_matched: 38,
        pagination: {
          limit: 5,
          offset: 0,
          has_more: true,
        },
        filters_applied: {
          full_name: null,
          city: 'Bengaluru',
          min_total_orders: 15,
        },
        data: [
          {
            id: 'd9b4b025-0ad3-4c90-93cb-93b5a770a8d4',
            full_name: 'Aarav Sharma',
            email: 'aarav.sharma@gmail.com',
            phone_number: '+91 98765 43210',
            city: 'Bengaluru',
            pincode: '560001',
            total_orders: 22,
            created_at: '2025-04-12T10:15:30.000Z',
          },
        ],
      },
    },
  })
  async searchEcommerceUsers(input: SearchEcommerceUsersInput, ctx: ExecutionContext) {
    const startTime = Date.now();
    ctx.logger.info(`[${ctx.requestId}] search_ecommerce_users called`, {
      filters: {
        full_name: input.full_name,
        city: input.city,
        min_total_orders: input.min_total_orders,
      },
      pagination: {
        limit: input.limit,
        offset: input.offset,
      },
    });

    try {
      // Build dynamic Prisma where query based on optional inputs
      const where: Prisma.ecom_usersWhereInput = {};

      if (input.full_name) {
        where.full_name = {
          contains: input.full_name,
          mode: 'insensitive',
        };
      }

      if (input.city) {
        where.city = {
          contains: input.city,
          mode: 'insensitive',
        };
      }

      if (input.min_total_orders !== undefined) {
        where.total_orders = {
          gte: input.min_total_orders,
        };
      }

      const limit = input.limit ?? 20;
      const offset = input.offset ?? 0;

      // Query database for matching records and total count
      const [totalMatched, users] = await Promise.all([
        prisma.ecom_users.count({ where }),
        prisma.ecom_users.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: [
            { total_orders: 'desc' },
            { created_at: 'desc' },
          ],
        }),
      ]);

      const durationMs = Date.now() - startTime;
      ctx.logger.info(`[${ctx.requestId}] search_ecommerce_users completed in ${durationMs}ms`, {
        total_matched: totalMatched,
        returned_count: users.length,
      });

      return {
        success: true,
        match_count: users.length,
        total_matched: totalMatched,
        pagination: {
          limit,
          offset,
          has_more: offset + users.length < totalMatched,
        },
        filters_applied: {
          full_name: input.full_name ?? null,
          city: input.city ?? null,
          min_total_orders: input.min_total_orders ?? null,
        },
        data: users.map((user) => ({
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          phone_number: user.phone_number,
          city: user.city,
          pincode: user.pincode,
          total_orders: user.total_orders,
          created_at: user.created_at.toISOString(),
        })),
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      ctx.logger.error(`[${ctx.requestId}] search_ecommerce_users failed after ${durationMs}ms`, {
        error: error?.message || String(error),
        stack: error?.stack,
      });

      return {
        success: false,
        error: error?.message || 'Database query failed.',
        match_count: 0,
        total_matched: 0,
        pagination: {
          limit: input.limit ?? 20,
          offset: input.offset ?? 0,
          has_more: false,
        },
        filters_applied: {
          full_name: input.full_name ?? null,
          city: input.city ?? null,
          min_total_orders: input.min_total_orders ?? null,
        },
        data: [],
      };
    }
  }

  /**
   * Look up a single e-commerce user by their ID or email address
   */
  @Tool({
    name: 'get_ecommerce_user_by_id',
    description: 'Retrieve detailed profile of a specific Indian e-commerce user by UUID or email address.',
    inputSchema: z.object({
      id: z.string().uuid().optional().describe('Unique UUID of the user (e.g. "009dbd25-ee2e-4be2-9840-66759dffc994")'),
      email: z.string().email().optional().describe('Email address of the user'),
    }).refine((data) => data.id || data.email, {
      message: 'Either id or email must be provided to look up a user.',
    }),
  })
  async getUserById(input: { id?: string; email?: string }, ctx: ExecutionContext) {
    ctx.logger.info(`[${ctx.requestId}] get_ecommerce_user_by_id called`, { input });

    try {
      const user = await prisma.ecom_users.findFirst({
        where: {
          OR: [
            ...(input.id ? [{ id: input.id }] : []),
            ...(input.email ? [{ email: input.email }] : []),
          ],
        },
      });

      if (!user) {
        return {
          success: false,
          message: 'User not found matching the provided identifier.',
          data: null,
        };
      }

      return {
        success: true,
        data: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          phone_number: user.phone_number,
          city: user.city,
          pincode: user.pincode,
          total_orders: user.total_orders,
          created_at: user.created_at.toISOString(),
        },
      };
    } catch (error: any) {
      ctx.logger.error(`[${ctx.requestId}] get_ecommerce_user_by_id failed`, {
        error: error?.message || String(error),
      });

      return {
        success: false,
        error: error?.message || 'Database query failed.',
        data: null,
      };
    }
  }
}
