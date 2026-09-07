import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { BrandMappingRepository } from './brand-mapping.repository';
import { CreateBrandMappingDto } from './dto/create-brand-mapping.dto';
import {
  AdvertisingPlatform,
  BrandMapping,
  BrandMappingWithAccounts,
  BrandPlatformAccount,
  ApiAccount
} from './brand-mapping.types';
import { CreateApiAccountDto, CreateApiAccountsBatchDto } from './dto/create-api-account.dto';

export type { BrandMapping } from './brand-mapping.types';

@Injectable()
export class BrandMappingService {
  private mappingsHydrated = false;
  private readonly defaultMappings: BrandMapping[] = [
    { cliente: 'WORLD SPORT', marca: 'Quiksilver' },
    { cliente: 'WORLD SPORT', marca: 'DC' },
    { cliente: 'WORLD SPORT', marca: 'Ala Moana' },
    { cliente: 'WORLD SPORT', marca: 'Roxy' },
    { cliente: 'WORLD SPORT', marca: 'RVCA' },
    { cliente: 'WORLD SPORT', marca: 'Boardriders' },
    { cliente: 'FRESH UP', marca: 'Care Up' },
    { cliente: 'FRESH UP', marca: 'Fresh Up' },
    { cliente: 'LP', marca: 'LP' },
    { cliente: 'ORMIFLEX', marca: 'Ormiflex' },
    { cliente: 'PAMPA BAY', marca: 'Pampa Bay' },
    { cliente: 'RP', marca: 'RP' },
    { cliente: 'BINDER RULEMANES', marca: 'Binder' },
    { cliente: 'ZONA FRANCA', marca: 'As Automotores' },
    { cliente: 'ZONA FRANCA', marca: 'Zona Franca' },
    { cliente: 'TV5', marca: 'TV5' },
    { cliente: 'IMQ', marca: 'Imq' },
    { cliente: 'CABRALES', marca: 'Cabrales' },
    // { cliente: 'MEDNET', marca: 'Mednet' },
    { cliente: 'LONDON', marca: 'DF_AS_Ushuaia' },
    { cliente: 'LONDON', marca: 'DF_AS_Rio Grande' },
    { cliente: 'LONDON', marca: 'DF_Patagonia_Shops' },
    { cliente: 'LONDON', marca: 'DF_Puerto Iguazú' },
    { cliente: 'LONDON', marca: 'Maria Taratuty' },
    { cliente: 'LONDON', marca: 'London Inst.' },
    { cliente: 'LONDON', marca: 'London Fundación' },
    { cliente: 'RHD', marca: 'RHD' }
  ];

  private mappings: BrandMapping[] = this.defaultMappings;

  constructor(private readonly brandMappingRepository: BrandMappingRepository) {}

  async getAll(): Promise<BrandMapping[]> {
    await this.hydrateMappings();
    return this.mappings.filter((item) => item.enabled !== false);
  }

  async getClients(): Promise<string[]> {
    await this.hydrateMappings();
    return Array.from(new Set(this.mappings.filter((item) => item.enabled !== false).map((item) => item.cliente))).sort();
  }

  async getBrandsByClient(cliente: string): Promise<string[]> {
    await this.hydrateMappings();
    const normalizedClient = this.normalize(cliente);

    return this.mappings
      .filter((item) => this.normalize(item.cliente) === normalizedClient)
      .filter((item) => item.enabled !== false)
      .map((item) => item.marca)
      .sort();
  }

  async getManagementMappings(): Promise<BrandMappingWithAccounts[]> {
    await this.hydrateMappings();

    try {
      return await this.brandMappingRepository.findAllWithAccounts();
    } catch {
      throw new ServiceUnavailableException('No se pudieron obtener los anunciantes y sus cuentas');
    }
  }

  async setSuspended(id: string, suspended: boolean): Promise<BrandMapping> {
    const updated = await this.brandMappingRepository.setSuspended(id, suspended);
    if (!updated) throw new BadRequestException('La relación de anunciante no existe');
    this.mappingsHydrated = false;
    return updated;
  }

  async getSuspendedKeys(): Promise<Set<string>> {
    try {
      const keys = await this.brandMappingRepository.findSuspendedKeys();
      return new Set(Array.from(keys).map((key) => {
        const [cliente, marca] = key.split('\u0000');
        return `${this.normalize(cliente)}\u0000${this.normalize(marca)}`;
      }));
    } catch {
      return new Set();
    }
  }

  async create(dto: CreateBrandMappingDto): Promise<BrandMappingWithAccounts> {
    const cliente = dto.cliente.trim();
    const marca = dto.marca.trim();
    if (!cliente || !marca) {
      throw new BadRequestException('Anunciante y marca son obligatorios');
    }

    const submittedAccounts = [
      ...(dto.accounts || []),
      ...(dto.metaAccountId === undefined
        ? []
        : [{ platform: AdvertisingPlatform.META, accountId: dto.metaAccountId }]),
      ...(dto.googleAccountId === undefined
        ? []
        : [{ platform: AdvertisingPlatform.GOOGLE, accountId: dto.googleAccountId }]),
      ...(dto.mercadoLibreAccountId === undefined
        ? []
        : [{ platform: AdvertisingPlatform.MERCADO_LIBRE, accountId: dto.mercadoLibreAccountId }]),
      ...(dto.tiktokAccountId === undefined
        ? []
        : [{ platform: AdvertisingPlatform.TIKTOK, accountId: dto.tiktokAccountId }])
    ];
    const uniqueAccounts = new Map<string, { platform: AdvertisingPlatform; accountId: string }>();
    for (const account of submittedAccounts) {
      const accountId = this.normalizeAccountId(account.platform, account.accountId);
      if (!accountId) throw new BadRequestException('Cada accountId debe contener un valor valido');
      if (!/^\d+$/.test(accountId)) {
        throw new BadRequestException(`El accountId de ${account.platform} debe ser numerico`);
      }
      uniqueAccounts.set(`${account.platform}:${accountId}`, { platform: account.platform, accountId });
    }

    try {
      const created = await this.brandMappingRepository.createWithAccounts({
        cliente,
        marca,
        accounts: Array.from(uniqueAccounts.values())
      });
      this.mappingsHydrated = false;
      return created;
    } catch (error: any) {
      if (error?.code === 'ACCOUNT_ALREADY_ASSIGNED' || error?.code === '23505') {
        throw new ConflictException('Una de las cuentas ya esta asociada a otro anunciante o marca');
      }
      throw new ServiceUnavailableException('No se pudo guardar el anunciante y sus cuentas');
    }
  }

  async getAccountsByPlatform(platform: AdvertisingPlatform): Promise<BrandPlatformAccount[]> {
    return this.brandMappingRepository.findAccountsByPlatform(platform);
  }

  async getApiAccounts(): Promise<ApiAccount[]> {
    return this.brandMappingRepository.findApiAccounts();
  }

  async createApiAccount(dto: CreateApiAccountDto): Promise<ApiAccount> {
    const accountId = this.normalizeAccountId(dto.platform, dto.accountId);
    if (!accountId || !/^\d+$/.test(accountId)) throw new BadRequestException('El accountId debe contener solamente dígitos');
    try {
      return await this.brandMappingRepository.createApiAccount({
        platform: dto.platform,
        accountId,
        accountName: dto.accountName?.trim(),
        enabled: dto.enabled !== false
      });
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('La cuenta ya está configurada');
      throw new ServiceUnavailableException('No se pudo guardar la cuenta');
    }
  }

  async createApiAccounts(target: string, dto: CreateApiAccountsBatchDto): Promise<ApiAccount[]> {
    const platform = this.resolveApiPlatform(target);
    if (!Array.isArray(dto.accountId) || dto.accountId.length === 0) {
      throw new BadRequestException('Debe enviar un array con al menos una cuenta');
    }

    const results: ApiAccount[] = [];
    for (const accountId of dto.accountId) {
      results.push(await this.createApiAccount({
        platform,
        accountId,
        accountName: dto.accountName,
        enabled: dto.enabled
      }));
    }
    return results;
  }

  async updateApiAccount(id: string, dto: Partial<CreateApiAccountDto>): Promise<ApiAccount> {
    const updated = await this.brandMappingRepository.updateApiAccount(id, { accountName: dto.accountName?.trim(), enabled: dto.enabled });
    if (!updated) throw new BadRequestException('La cuenta no existe');
    return updated;
  }

  async deleteApiAccount(id: string): Promise<void> {
    if (!(await this.brandMappingRepository.deleteApiAccount(id))) throw new BadRequestException('La cuenta no existe');
  }

  private resolveApiPlatform(target: string): AdvertisingPlatform {
    const normalized = this.normalize(target).replace(/[\s_-]+/g, '');
    const platform = {
      meta: AdvertisingPlatform.META,
      google: AdvertisingPlatform.GOOGLE,
      tiktok: AdvertisingPlatform.TIKTOK,
      meli: AdvertisingPlatform.MERCADO_LIBRE,
      mercadolibre: AdvertisingPlatform.MERCADO_LIBRE
    }[normalized];
    if (!platform) throw new BadRequestException('La plataforma debe ser meta, google, tiktok o mercado-libre');
    return platform;
  }

  async resolveClientBrand(cliente: string, marca: string): Promise<BrandMapping> {
    await this.hydrateMappings();
    const normalizedClient = this.normalize(cliente);
    const normalizedBrand = this.normalize(marca);
    const exact = this.mappings.find((item) => (
      this.normalize(item.cliente) === normalizedClient
      && this.normalize(item.marca) === normalizedBrand
    ));

    if (exact) return exact;

    const byBrand = await this.resolve(marca);
    if (byBrand.cliente !== 'SIN MAPEO') return byBrand;

    return {
      cliente: cliente.trim(),
      marca: marca.trim()
    };
  }

  async resolve(reference: string): Promise<BrandMapping> {
    await this.hydrateMappings();
    const normalizedReference = this.normalize(reference);
    const alias = this.resolveAlias(normalizedReference);
    if (alias) return alias;

    const exact = this.mappings.find((item) => this.normalize(item.marca) === normalizedReference);
    if (exact) return exact;

    const contained = this.mappings.find((item) => {
      const brand = this.normalize(item.marca);
      return normalizedReference.includes(brand) || brand.includes(normalizedReference);
    });
    if (contained) return contained;

    return {
      cliente: 'SIN MAPEO',
      marca: this.toTitleCase(reference || 'Sin referencia')
    };
  }

  normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[_\s]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  normalizeAccountId(platform: AdvertisingPlatform, value: string): string {
    const clean = String(value || '').trim();
    if (platform === AdvertisingPlatform.META) return clean.replace(/^act_/i, '').trim();
    if (platform === AdvertisingPlatform.GOOGLE) return clean.replace(/-/g, '').trim();
    return clean;
  }

  private resolveAlias(normalizedReference: string): BrandMapping | null {
    if (normalizedReference.includes('regalando pasion')) {
      return { cliente: 'RP', marca: 'RP' };
    }

    if (normalizedReference.includes('fundacion gls')) {
      return { cliente: 'LONDON', marca: 'London Fundación' };
    }

    return null;
  }

  private toTitleCase(value: string): string {
    return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private async hydrateMappings(): Promise<void> {
    if (this.mappingsHydrated) return;
    this.mappingsHydrated = true;

    try {
      await this.brandMappingRepository.seed(this.defaultMappings);
      const databaseMappings = await this.brandMappingRepository.findAll();
      if (databaseMappings.length > 0 || this.brandMappingRepository.enabled) {
        this.mappings = databaseMappings
          .filter((mapping) => !this.isInactiveClient(mapping.cliente))
          .map((mapping) => ({ ...mapping, enabled: mapping.enabled !== false }));
      }
    } catch {
      this.mappings = this.defaultMappings;
    }
  }

  private isInactiveClient(cliente: string): boolean {
    const normalizedClient = this.normalize(cliente).replace(/\s+/g, '');
    return normalizedClient.includes('bachet') || normalizedClient.includes('bacchet');
  }
}
