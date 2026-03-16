const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(limit, maxLimit = MAX_LIMIT) {
  return Math.min(limit, maxLimit);
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function parsePagination(query = {}, options = {}) {
  const {
    defaultPage = DEFAULT_PAGE,
    defaultLimit = DEFAULT_LIMIT,
    maxLimit = MAX_LIMIT,
  } = options;

  const page = toPositiveInteger(query.page, defaultPage);
  const requestedLimit = toPositiveInteger(query.limit, defaultLimit);
  const limit = clampLimit(requestedLimit, maxLimit);
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip,
  };
}

function parseSort(query = {}, options = {}) {
  const {
    defaultSortBy = "created_at",
    defaultSortOrder = "desc",
    allowedSortBy = ["created_at"],
  } = options;

  const rawSortBy = query.sort_by || defaultSortBy;
  const sortBy = allowedSortBy.includes(rawSortBy) ? rawSortBy : defaultSortBy;

  const rawSortOrder = String(query.sort_order || defaultSortOrder).toLowerCase();
  const sortOrder = rawSortOrder === "asc" ? 1 : -1;

  return {
    sortBy,
    sortOrder,
    sort: { [sortBy]: sortOrder },
  };
}

function buildPagination(totalItems, page, limit) {
  const total = Number.isFinite(totalItems) && totalItems >= 0 ? totalItems : 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    page,
    limit,
    total_items: total,
    total_pages: totalPages,
    has_next: totalPages > 0 && page < totalPages,
    has_prev: totalPages > 0 && page > 1,
  };
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePagination,
  parseSort,
  buildPagination,
};