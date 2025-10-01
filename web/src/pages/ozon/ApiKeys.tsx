/**
 * API Key管理页面
 */
import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Alert,
  Snackbar,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  Refresh as RefreshIcon,
  Key as KeyIcon,
} from '@mui/icons-material';
import {
  listAPIKeys,
  createAPIKey,
  deleteAPIKey,
  regenerateAPIKey,
  APIKey,
  CreateAPIKeyRequest,
} from '../../services/apiKeyService';

const ApiKeys: React.FC = () => {
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [newKeyData, setNewKeyData] = useState<{ key: string; name: string } | null>(null);

  // 表单状态
  const [formData, setFormData] = useState<CreateAPIKeyRequest>({
    name: '',
    permissions: ['product_selection:write'],
    expires_in_days: undefined,
  });

  // 通知状态
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({
    open: false,
    message: '',
    severity: 'info',
  });

  // 加载API Keys
  const loadKeys = async () => {
    try {
      setLoading(true);
      const data = await listAPIKeys();
      setKeys(data);
    } catch (error: any) {
      showSnackbar('加载API Keys失败: ' + (error.response?.data?.message || error.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  // 显示通知
  const showSnackbar = (message: string, severity: 'success' | 'error' | 'info') => {
    setSnackbar({ open: true, message, severity });
  };

  // 创建API Key
  const handleCreate = async () => {
    if (!formData.name.trim()) {
      showSnackbar('请输入Key名称', 'error');
      return;
    }

    try {
      const result = await createAPIKey(formData);
      setNewKeyData({ key: result.key, name: result.name });
      setKeyDialogOpen(true);
      setCreateDialogOpen(false);
      setFormData({
        name: '',
        permissions: ['product_selection:write'],
        expires_in_days: undefined,
      });
      loadKeys();
      showSnackbar('API Key创建成功', 'success');
    } catch (error: any) {
      showSnackbar('创建失败: ' + (error.response?.data?.message || error.message), 'error');
    }
  };

  // 删除API Key
  const handleDelete = async (keyId: number, name: string) => {
    if (!window.confirm(`确定要删除 "${name}" 吗？此操作不可恢复！`)) {
      return;
    }

    try {
      await deleteAPIKey(keyId);
      loadKeys();
      showSnackbar('API Key已删除', 'success');
    } catch (error: any) {
      showSnackbar('删除失败: ' + (error.response?.data?.message || error.message), 'error');
    }
  };

  // 重新生成API Key
  const handleRegenerate = async (keyId: number, name: string) => {
    if (!window.confirm(`确定要重新生成 "${name}" 吗？旧的Key将立即失效！`)) {
      return;
    }

    try {
      const result = await regenerateAPIKey(keyId);
      setNewKeyData({ key: result.key, name: result.name });
      setKeyDialogOpen(true);
      loadKeys();
      showSnackbar('API Key已重新生成', 'success');
    } catch (error: any) {
      showSnackbar('重新生成失败: ' + (error.response?.data?.message || error.message), 'error');
    }
  };

  // 复制到剪贴板
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        showSnackbar('已复制到剪贴板', 'success');
      },
      () => {
        showSnackbar('复制失败', 'error');
      }
    );
  };

  // 格式化日期
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  // 判断是否过期
  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" gutterBottom>
            <KeyIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            API密钥管理
          </Typography>
          <Typography variant="body2" color="text.secondary">
            用于Tampermonkey脚本等外部工具的身份认证
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          创建API Key
        </Button>
      </Box>

      {/* 使用提示 */}
      <Alert severity="info" sx={{ mb: 3 }}>
        <strong>使用说明：</strong>
        <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
          <li>创建API Key后，请立即复制并妥善保存，系统不会再次显示完整Key</li>
          <li>在Tampermonkey脚本中配置API地址和Key，即可自动上传采集的商品数据</li>
          <li>如果Key泄露，请立即删除或重新生成</li>
        </ul>
      </Alert>

      {/* API Keys列表 */}
      <Card>
        <CardContent>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : keys.length === 0 ? (
            <Box sx={{ textAlign: 'center', p: 4 }}>
              <Typography variant="body1" color="text.secondary">
                还没有API Key，点击上方"创建API Key"按钮开始创建
              </Typography>
            </Box>
          ) : (
            <TableContainer component={Paper} elevation={0}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>名称</TableCell>
                    <TableCell>权限</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>最后使用</TableCell>
                    <TableCell>过期时间</TableCell>
                    <TableCell>创建时间</TableCell>
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {keys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {key.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {key.permissions.map((perm) => (
                          <Chip key={perm} label={perm} size="small" sx={{ mr: 0.5 }} />
                        ))}
                      </TableCell>
                      <TableCell>
                        {key.is_active && !isExpired(key.expires_at) ? (
                          <Chip label="激活" color="success" size="small" />
                        ) : isExpired(key.expires_at) ? (
                          <Chip label="已过期" color="error" size="small" />
                        ) : (
                          <Chip label="已禁用" color="default" size="small" />
                        )}
                      </TableCell>
                      <TableCell>{formatDate(key.last_used_at)}</TableCell>
                      <TableCell>
                        {key.expires_at ? (
                          <Typography
                            variant="body2"
                            color={isExpired(key.expires_at) ? 'error' : 'text.primary'}
                          >
                            {formatDate(key.expires_at)}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            永不过期
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{formatDate(key.created_at)}</TableCell>
                      <TableCell align="right">
                        <Tooltip title="重新生成">
                          <IconButton
                            size="small"
                            onClick={() => handleRegenerate(key.id, key.name)}
                            color="primary"
                          >
                            <RefreshIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="删除">
                          <IconButton
                            size="small"
                            onClick={() => handleDelete(key.id, key.name)}
                            color="error"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* 创建对话框 */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>创建API Key</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Key名称"
              placeholder="例如：Tampermonkey脚本"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              sx={{ mb: 2 }}
              required
            />

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>过期时间</InputLabel>
              <Select
                value={formData.expires_in_days || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    expires_in_days: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                label="过期时间"
              >
                <MenuItem value="">永不过期</MenuItem>
                <MenuItem value={30}>30天</MenuItem>
                <MenuItem value={90}>90天</MenuItem>
                <MenuItem value={180}>180天</MenuItem>
                <MenuItem value={365}>365天</MenuItem>
              </Select>
            </FormControl>

            <Alert severity="warning" sx={{ mt: 2 }}>
              <strong>重要提示：</strong>API Key仅在创建时显示一次，请务必复制保存！
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>取消</Button>
          <Button onClick={handleCreate} variant="contained">
            创建
          </Button>
        </DialogActions>
      </Dialog>

      {/* 显示新Key对话框 */}
      <Dialog
        open={keyDialogOpen}
        onClose={() => setKeyDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {newKeyData?.name ? `API Key: ${newKeyData.name}` : 'API Key'}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <strong>请立即复制并保存！</strong>此Key将仅显示一次，关闭后无法再次查看。
          </Alert>
          <Box
            sx={{
              p: 2,
              bgcolor: 'grey.100',
              borderRadius: 1,
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              position: 'relative',
            }}
          >
            <Typography variant="body2">{newKeyData?.key}</Typography>
            <IconButton
              size="small"
              sx={{ position: 'absolute', top: 8, right: 8 }}
              onClick={() => newKeyData && copyToClipboard(newKeyData.key)}
            >
              <CopyIcon />
            </IconButton>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => copyToClipboard(newKeyData?.key || '')} startIcon={<CopyIcon />}>
            复制
          </Button>
          <Button onClick={() => setKeyDialogOpen(false)} variant="contained">
            我已保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 通知 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default ApiKeys;
