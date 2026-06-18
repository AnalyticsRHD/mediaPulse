import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '../../config/config.service';

@Injectable()
export class AirtableService {
  private logger = new Logger('AirtableService');
  private client: AxiosInstance | null = null;
  private baseId: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.airtableApiKey;
    const baseId = this.configService.airtableBaseId;

    this.baseId = baseId;

    if (apiKey && baseId) {
      this.client = axios.create({
        baseURL: `https://api.airtable.com/v0/${baseId}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      this.logger.log('Airtable initialized successfully via HTTP API');
    } else {
      this.logger.warn('Airtable credentials not found. Airtable operations disabled.');
    }
  }

  private getClient(): AxiosInstance {
    if (!this.client) {
      throw new ServiceUnavailableException('Airtable is not configured');
    }

    return this.client;
  }

  async getRecords(tableName: string, options?: any): Promise<any[]> {
    const client = this.getClient();

    try {
      const records: any[] = [];
      let offset: string | undefined;

      do {
        const url = tableName;
        const params = options || {};
        if (offset) params.offset = offset;

        const response = await client.get(url, { params });
        records.push(
          ...response.data.records.map((r: any) => ({
            id: r.id,
            ...r.fields
          }))
        );
        offset = response.data.offset;
      } while (offset);

      return records;
    } catch (error) {
      this.logger.error(`Error fetching records from ${tableName}:`, error);
      return [];
    }
  }

  async getRecordById(tableName: string, recordId: string): Promise<any> {
    const client = this.getClient();

    try {
      const response = await client.get(`${tableName}/${recordId}`);
      return { id: response.data.id, ...response.data.fields };
    } catch (error) {
      this.logger.error(`Error fetching record ${recordId}:`, error);
      return null;
    }
  }

  async createRecord(tableName: string, fields: any): Promise<any> {
    const client = this.getClient();

    try {
      const response = await client.post(tableName, {
        fields,
        typecast: true
      });
      return { id: response.data.id, ...response.data.fields };
    } catch (error) {
      this.logger.error(`Error creating record in ${tableName}:`, error);
      throw error;
    }
  }

  async updateRecord(tableName: string, recordId: string, fields: any): Promise<any> {
    const client = this.getClient();

    try {
      const response = await client.patch(`${tableName}/${recordId}`, {
        fields,
        typecast: true
      });
      return { id: response.data.id, ...response.data.fields };
    } catch (error) {
      this.logger.error(`Error updating record ${recordId}:`, error);
      throw error;
    }
  }

  async deleteRecord(tableName: string, recordId: string): Promise<boolean> {
    const client = this.getClient();

    try {
      await client.delete(`${tableName}/${recordId}`);
      return true;
    } catch (error) {
      this.logger.error(`Error deleting record ${recordId}:`, error);
      return false;
    }
  }

  async upsertRecords(
    tableName: string,
    records: Array<{ fields: any; typecast?: boolean }>
  ): Promise<any[]> {
    const client = this.getClient();

    try {
      const result: any[] = [];

      // Airtable API batch limit is 10
      for (let i = 0; i < records.length; i += 10) {
        const batch = records.slice(i, i + 10);
        const response = await client.post(tableName, {
          records: batch.map(r => ({
            fields: r.fields,
            typecast: r.typecast !== false
          }))
        });
        result.push(
          ...response.data.records.map((r: any) => ({
            id: r.id,
            ...r.fields
          }))
        );
      }

      return result;
    } catch (error) {
      this.logger.error(`Error upserting records in ${tableName}:`, error);
      throw error;
    }
  }

  isConfigured(): boolean {
    return !!this.client;
  }
}
