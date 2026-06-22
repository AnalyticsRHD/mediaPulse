import { Injectable } from '@nestjs/common';
import { BrandMappingRepository } from './brand-mapping.repository';

export type BrandMapping = {
  cliente: string;
  marca: string;
};

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
    { cliente: 'CASA BACHETTII ZANOTTI', marca: 'Casa Bachettii' },
    { cliente: 'MEDNET', marca: 'Mednet' },
    { cliente: 'LONDON', marca: 'DF_AS_Ushuaia' },
    { cliente: 'LONDON', marca: 'DF_AS_Rio Grande' },
    { cliente: 'LONDON', marca: 'DF_Patagonia_Shops' },
    { cliente: 'LONDON', marca: 'DF_Puerto Iguazú' },
    { cliente: 'LONDON', marca: 'Maria Taratuty' },
    { cliente: 'LONDON', marca: 'London Inst.' },
    { cliente: 'LONDON', marca: 'London Fundación' },
    { cliente: 'RHD', marca: 'Rhd' }
  ];

  private mappings: BrandMapping[] = this.defaultMappings;

  constructor(private readonly brandMappingRepository: BrandMappingRepository) {}

  async getAll(): Promise<BrandMapping[]> {
    await this.hydrateMappings();
    return this.mappings;
  }

  async getClients(): Promise<string[]> {
    await this.hydrateMappings();
    return Array.from(new Set(this.mappings.map((item) => item.cliente))).sort();
  }

  async getBrandsByClient(cliente: string): Promise<string[]> {
    await this.hydrateMappings();
    const normalizedClient = this.normalize(cliente);

    return this.mappings
      .filter((item) => this.normalize(item.cliente) === normalizedClient)
      .map((item) => item.marca)
      .sort();
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
        this.mappings = databaseMappings;
      }
    } catch {
      this.mappings = this.defaultMappings;
    }
  }
}
