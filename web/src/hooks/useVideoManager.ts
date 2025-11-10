/**
 * 视频管理 Hook
 *
 * 功能：
 * - 管理视频列表状态
 * - 添加/编辑/删除视频
 * - 封面视频校验（只能有1个）
 * - 视频URL格式验证
 */
import { useState, useCallback } from "react";
import { notifyError, notifyWarning } from "@/utils/notification";
import { loggers } from "@/utils/logger";
import type { VideoInfo } from "@/services/ozonApi";

interface UseVideoManagerOptions {
  /**
   * 初始视频列表
   */
  initialVideos?: VideoInfo[];

  /**
   * 视频数量限制
   * @default 10
   */
  maxVideos?: number;

  /**
   * 当视频列表变化时的回调
   */
  onChange?: (videos: VideoInfo[]) => void;
}

/**
 * 验证视频URL格式
 */
const isValidVideoUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

export const useVideoManager = ({
  initialVideos = [],
  maxVideos = 10,
  onChange,
}: UseVideoManagerOptions = {}) => {
  const [videos, setVideos] = useState<VideoInfo[]>(initialVideos);

  /**
   * 添加视频
   */
  const addVideo = useCallback(
    (video: VideoInfo) => {
      // 验证URL格式
      if (!isValidVideoUrl(video.url)) {
        notifyError(
          "视频URL格式无效",
          "请输入有效的视频URL地址"
        );
        return false;
      }

      // 检查数量限制
      if (videos.length >= maxVideos) {
        notifyWarning(
          "视频数量已达上限",
          `最多只能添加 ${maxVideos} 个视频`
        );
        return false;
      }

      // 检查URL是否重复
      if (videos.some((v) => v.url === video.url)) {
        notifyWarning(
          "视频已存在",
          "该视频URL已添加，请勿重复添加"
        );
        return false;
      }

      // 检查封面视频限制
      if (video.is_cover && videos.some((v) => v.is_cover)) {
        notifyWarning(
          "只能有1个封面视频",
          "已存在封面视频，请先取消原有封面视频"
        );
        return false;
      }

      const newVideos = [...videos, video];
      setVideos(newVideos);
      onChange?.(newVideos);
      loggers.product.info("添加视频成功", { url: video.url });
      return true;
    },
    [videos, maxVideos, onChange]
  );

  /**
   * 更新视频
   */
  const updateVideo = useCallback(
    (index: number, updates: Partial<VideoInfo>) => {
      if (index < 0 || index >= videos.length) {
        notifyError("视频索引无效", "");
        return false;
      }

      // 检查封面视频限制
      if (updates.is_cover) {
        const otherCoverIndex = videos.findIndex(
          (v, i) => i !== index && v.is_cover
        );
        if (otherCoverIndex !== -1) {
          notifyWarning(
            "只能有1个封面视频",
            "已存在封面视频，请先取消原有封面视频"
          );
          return false;
        }
      }

      const newVideos = [...videos];
      newVideos[index] = { ...newVideos[index], ...updates };
      setVideos(newVideos);
      onChange?.(newVideos);
      loggers.product.info("更新视频成功", { index, updates });
      return true;
    },
    [videos, onChange]
  );

  /**
   * 删除视频
   */
  const removeVideo = useCallback(
    (index: number) => {
      if (index < 0 || index >= videos.length) {
        notifyError("视频索引无效", "");
        return false;
      }

      const newVideos = videos.filter((_, i) => i !== index);
      setVideos(newVideos);
      onChange?.(newVideos);
      loggers.product.info("删除视频成功", { index });
      return true;
    },
    [videos, onChange]
  );

  /**
   * 设置/取消封面视频（切换）
   */
  const setCoverVideo = useCallback(
    (index: number) => {
      if (index < 0 || index >= videos.length) {
        notifyError("视频索引无效", "");
        return false;
      }

      const currentIsCover = videos[index].is_cover;

      const newVideos = videos.map((v, i) => ({
        ...v,
        is_cover: currentIsCover ? false : i === index, // 如果已是封面则取消，否则设为封面
      }));
      setVideos(newVideos);
      onChange?.(newVideos);
      loggers.product.info(currentIsCover ? "取消封面视频" : "设置封面视频成功", { index });
      return true;
    },
    [videos, onChange]
  );

  /**
   * 清空所有视频
   */
  const clearVideos = useCallback(() => {
    setVideos([]);
    onChange?.([]);
    loggers.product.info("清空所有视频");
  }, [onChange]);

  /**
   * 重置为初始视频列表
   */
  const resetVideos = useCallback(() => {
    setVideos(initialVideos);
    onChange?.(initialVideos);
    loggers.product.info("重置视频列表");
  }, [initialVideos, onChange]);

  /**
   * 获取封面视频
   */
  const getCoverVideo = useCallback(() => {
    return videos.find((v) => v.is_cover) || null;
  }, [videos]);

  /**
   * 获取普通视频列表
   */
  const getRegularVideos = useCallback(() => {
    return videos.filter((v) => !v.is_cover);
  }, [videos]);

  return {
    /** 视频列表 */
    videos,

    /** 添加视频 */
    addVideo,

    /** 更新视频 */
    updateVideo,

    /** 删除视频 */
    removeVideo,

    /** 设置封面视频 */
    setCoverVideo,

    /** 清空所有视频 */
    clearVideos,

    /** 重置为初始视频列表 */
    resetVideos,

    /** 获取封面视频 */
    getCoverVideo,

    /** 获取普通视频列表 */
    getRegularVideos,

    /** 是否已达数量上限 */
    isMaxReached: videos.length >= maxVideos,

    /** 视频数量 */
    count: videos.length,
  };
};
