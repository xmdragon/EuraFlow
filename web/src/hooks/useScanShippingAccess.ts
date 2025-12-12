/**
 * 扫描单号权限 Hook
 *
 * 检查用户是否有权限访问扫描单号页面：
 * - shipper: 有托管店铺时可访问
 * - admin/manager/sub_account: 有未托管店铺时可访问
 */
import { useQuery } from "@tanstack/react-query";
import axios from "@/services/axios";

interface ScanShippingAccessResponse {
  has_access: boolean;
  is_shipper: boolean;
  shop_count: number;
}

export function useScanShippingAccess() {
  const { data, isLoading } = useQuery<ScanShippingAccessResponse>({
    queryKey: ["scan-shipping-access"],
    queryFn: async () => {
      const response = await axios.get<ScanShippingAccessResponse>(
        "/api/ef/v1/ozon/scan-shipping/access"
      );
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 分钟缓存
    refetchOnWindowFocus: false,
  });

  return {
    hasAccess: data?.has_access ?? false,
    isShipper: data?.is_shipper ?? false,
    shopCount: data?.shop_count ?? 0,
    isLoading,
  };
}
