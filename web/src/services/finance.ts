import { apiClient } from "@/utils/api";

export interface ShippingRequest {
  platform: string;
  service_type?: string;
  weight_g: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  declared_value?: number;
  selling_price: number;
  battery?: boolean;
  fragile?: boolean;
  liquid?: boolean;
  insurance?: boolean;
  insurance_value?: number;
}

export interface ProfitRequest {
  sku: string;
  platform: string;
  cost: number;
  selling_price: number;
  weight_g: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  fulfillment_model: string;
  category_code?: string;
  platform_fee_rate?: number;
  compare_shipping?: boolean;
  preferred_service?: string;
}

export interface ShippingResult {
  request_id: string;
  platform: string;
  carrier_service: string;
  service_type: string;
  actual_weight_kg: number;
  volume_weight_kg: number;
  chargeable_weight_kg: number;
  weight_step_kg: number;
  rounded_weight_kg: number;
  base_rate: number;
  weight_rate: number;
  surcharges: Record<string, number>;
  total_cost: number;
  delivery_days_min: number;
  delivery_days_max: number;
  min_charge_applied: boolean;
  oversize_applied: boolean;
  rejected: boolean;
  rejection_reason?: string;
  scenario: string;
  rate_id: string;
  rate_version: string;
  effective_from: string;
}

export interface ProfitResult {
  request_id: string;
  sku: string;
  platform: string;
  cost: number;
  selling_price: number;
  platform_fee: number;
  platform_fee_rate: number;
  shipping_options?: Record<string, ShippingResult>;
  recommended_shipping?: string;
  selected_shipping_cost: number;
  profit_amount: number;
  profit_rate: number;
  scenario: string;
  margin_analysis: {
    gross_margin: number;
    gross_margin_rate: number;
    cost_breakdown: Record<string, number>;
    margin_level: string;
  };
  optimizations?: Array<{
    suggested_price: number;
    expected_profit: number;
    expected_profit_rate: number;
    price_adjustment: number;
    optimization_reason: string;
  }>;
  warnings?: string[];
}

class FinanceService {
  private baseUrl = "/api/ef/v1/finance";

  async calculateShipping(request: ShippingRequest): Promise<ShippingResult> {
    const response = await apiClient.post(
      `${this.baseUrl}/shipping/calculate`,
      request,
    );
    return response.data;
  }

  async calculateMultipleShipping(
    request: ShippingRequest,
    serviceTypes?: string[],
  ): Promise<ShippingResult[]> {
    const params = serviceTypes
      ? { service_types: serviceTypes.join(",") }
      : undefined;
    const response = await apiClient.post(
      `${this.baseUrl}/shipping/calculate-multiple`,
      request,
      { params },
    );
    return response.data;
  }

  async calculateProfit(request: ProfitRequest): Promise<ProfitResult> {
    const response = await apiClient.post(
      `${this.baseUrl}/profit/calculate`,
      request,
    );
    return response.data;
  }

  async batchCalculateShipping(
    requests: ShippingRequest[],
  ): Promise<ShippingResult[]> {
    const response = await apiClient.post(`${this.baseUrl}/shipping/batch`, {
      requests,
    });
    return response.data;
  }

  async batchCalculateProfit(
    requests: ProfitRequest[],
  ): Promise<ProfitResult[]> {
    const response = await apiClient.post(`${this.baseUrl}/profit/batch`, {
      requests,
    });
    return response.data;
  }

  async getRateVersions(): Promise<any> {
    const response = await apiClient.get(`${this.baseUrl}/rates/versions`);
    return response.data;
  }

  async reloadRates(): Promise<any> {
    const response = await apiClient.get(`${this.baseUrl}/rates/reload`);
    return response.data;
  }

  async healthCheck(): Promise<any> {
    const response = await apiClient.get(`${this.baseUrl}/health`);
    return response.data;
  }
}

export const financeService = new FinanceService();
