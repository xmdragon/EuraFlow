# 加载图片

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v4/product/info/limit`

## 详细信息

如果您按照FBP工作模式从中国或香港销售，那么请为每件商品生成条形码。合作伙伴仓库将无法接收没有条形码的商品。 

创建商品并更新有关商品信息的方法。

欲知限制，请使用 /v4/product/info/limit。 如果商品下载和更新次数 超过限制，则出现错误 `item_limit_exceeded`。

一次请求最多可转移100种商品。 每个商品都是数组中的单独元素 `items`。 请指出 有关商品的所有信息：特征、条形码、图像、尺寸、价格和价格货币。

在更新商品时，请在请求中转达有关商品的所有信息。

指定货币必须与个人中心中设置的币种相匹配。 默认情况下显示 `RUB` — 俄罗斯卢布。 如果您设置了人民币为币种, 请选择 `CNY`, 否则将返回错误。

如果您填写错误或指定，则不会创建或更新商品:

  * **强制特征** : 不同类目的属性有所不同——您可以在 [卖家知识库](https://docs.ozon.ru/global/zh-hans/products/requirements/product-info/product-characteristics/#%E5%9C%A8%E5%93%AA%E9%87%8C%E6%8C%87%E5%AE%9A%E5%BF%85%E8%A6%81%E5%95%86%E5%93%81%E7%89%B9%E6%80%A7) 中查看，或者通过方法 /v1/description-category/attribute获取。
  * **真实体积和重量特性** : `depth`, `width`, `height`, `dimension_unit`, `weight`, `weight_unit`。请勿在请求中跳过这些参数，也不要指定0。



HTML标签可用于某些特征。

[更多关于特征的信息可见卖家知识库](https://docs.ozon.ru/global/zh-hans/products/requirements/product-info/product-characteristics/)

审核后，该商品将出现在您的个人中心中，但在您将其出售之前，用户将无法看到该商品。

请求中的每项都是数组的单独元素 `items`。

为连接两张卡片, 请对每张卡片传递`9048` 在 `attributes`中。 这些卡片除了大小或颜色外的所有属性都必须匹配。

## 加载图片

若要上传，请将请求中的图像链接发至公共云存储中。 链接的图像格式为JPG或PNG。

按照网站上所需的顺序将图像放在`images` 数组中。 要加载主图请使用 `primary_image`参数。 如果没有传递 `primary_image`值, 主图将是 在 `images`组中的第一张图片。

对于每个商品，您最多可以上传15个图像，包括主图像。 如果传递 `primary_image`值, 在 `images` 的最大图像数为——14。 如果参数 `primary_image` 为空, 那么在`images` 可以传递最多15张图片。

若要上传招聘360，请使用`images360`字段, 上传营销名字 — `color_image`。

如果要更改图像的构图或顺序，请使用 /v3/product/info/list 方法获取信息 —— 里面显示当前订单和 图像组成。 请复制 `images`, `images360`, `color_image`字段的数据, 更改和完成列表或者 根据需求订购。

## 上传视频

上传视频请在请求中上传视频链接。

为此，请在 `complex_attributes`参数中传递对象。在`attributes`数组中，请传递两个含`complex_id = 100001`的对象:

  * 在第一个中，请赋值指定 `id = 21841` 和在数组 `values` 中传输含视频链接的对象。

**例子** :
        
        {
          "complex_id": 100001,
          "id": 21841,
          "values": [
            {
              "value": "https://www.youtube.com/watch?v=ZwM0iBn03dY"
            }
          ]
        }

  * 在二个中，请指定值`id = 21837` 和在 `values` 数组中传输含视频名称的对象。

**例子** :
        
        {
          "complex_id": 100001,
          "id": 21837,
          "values": [
            {
              "value": "videoName_1"
            }
          ]
        }




如果您想上传视频, 请在不同的`values`数组对象中为每个视频赋值。

**例子** :
    
    
      {
        "complex_id": 100001,
        "id": 21837,
        "values": [
          {
            "value": "videoName_1"
          },
          {
            "value": "videoName_2"
          }
        ]
      },
      {
        "complex_id": 100001,
        "id": 21841,
        "values": [
          {
            "value": "https://www.youtube.com/watch?v=ZwM0iBn03dY"
          },
          {
            "value": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
          }
        ]
      }

## 上传尺寸表

为添加使用以下方法创建的尺寸图表 [设计](https://table-constructor.ozon.ru/visual-editor), 请在`attributes`组传递表格，格式 JSON 如 Rich-内容 `id = 13164`。   
  
[JSON格式的设计](https://table-constructor.ozon.ru/schema.json)  
[更多关于设计可见卖家知识库](https://docs.ozon.ru/global/zh-hans/products/upload/adding-content/size-table-constructor/)

## 视频封面上传

您可以通过综合属性上传视频封面 `complex_attributes`。

**例子** ：
    
    
    "complex_attributes": [
      {
        "attributes": [
          {
            "id": 21845,
            "complex_id": 100002,
            "values": [
              {
              "dictionary_value_id": 0,
              "value": "https://v.ozone.ru/vod/video-10/01GFATWQVCDE7G5B721421P1231Q7/asset_1.mp4"
              }
            ]
          }
        ]
      }
    ]
