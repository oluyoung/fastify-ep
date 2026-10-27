import { AppError } from '../../errors/app-error.js';
import type { UsersRepository } from './users.repository.js';
import type {
  CreateUserBody,
  User,
  UpdateUserBody,
} from './users.schema.js';

function notFound(): AppError {
  return new AppError('NOT_FOUND', 'User not found', 404);
}

export class UsersService {
  private readonly repository: UsersRepository;

  constructor({ usersRepository }: { usersRepository: UsersRepository }) {
    this.repository = usersRepository;
  }

  list(): Promise<User[]> {
    return this.repository.findAll();
  }

  async get(id: string): Promise<User> {
    const item = await this.repository.findById(id);
    if (!item) throw notFound();
    return item;
  }

  create(data: CreateUserBody): Promise<User> {
    return this.repository.create(data);
  }

  async update(id: string, data: UpdateUserBody): Promise<User> {
    const item = await this.repository.update(id, data);
    if (!item) throw notFound();
    return item;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.repository.delete(id);
    if (!deleted) throw notFound();
  }
}
