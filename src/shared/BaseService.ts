export abstract class BaseService {
  protected getPaginationParams(page: number = 1, limit: number = 10, sort: string = 'id') {
    const skip = (page - 1) * limit;
    const take = limit;
    const order = sort.startsWith('-') ? 'desc' : 'asc';
    const field = sort.startsWith('-') ? sort.slice(1) : sort;

    return { page, limit, skip, take, orderBy: { [field]: order } };
  }
}
