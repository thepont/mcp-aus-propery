# Australian Real Estate Technology Stack

Complete guide to CRM systems, APIs, and platforms used by major Australian real estate agencies.

## The Big Three CRM Systems

### 1. VaultRE (Ray White & LJ Hooker)

**Who Uses It**: Ray White, LJ Hooker (branded as "OneSystem")

**API Documentation**: https://docs.api.vaultre.com.au  
**Interactive Explorer**: https://docs.api.vaultre.com.au/swagger/index.html  
**Base Endpoint**: `https://ap-southeast-2.api.vaultre.com.au/api/v1.3/`

**Key Endpoints**:
- `/properties/residential/sale` - Properties for sale
- `/properties/residential/lease` - Rental properties
- `/properties/commercial` - Commercial properties

**Authentication**: OAuth2 (Bearer Tokens) or static API Keys  
**Access**: Requires invitation from office principal via "Office Integrations"

**Identification**:
- Image URLs containing `vaultre.com.au`
- API calls to `onesystem.raywhite.com`
- References to `nurturecloud.com` (Agent OS)

**Proxy Pattern**: Many Ray White offices expose a public proxy:
```
https://{office-website}/api/proxy/v1/listings
```
This doesn't require authentication!

---

### 2. Rex Software (Boutique & Independent Agencies)

**Who Uses It**: Independent agencies, boutique firms

**API Documentation**: https://api-docs.rexsoftware.com  
**Base Endpoint**: `https://api.rexsoftware.com`

**Architecture**: Service-oriented (not traditional REST)
- Methods like `Authentication::login`, `Listing::search`
- Uses POST requests with method names
- Custom header: `X-api-option` for strict arguments

**Authentication**: Requires token from a Rex user

**Best For**: High-speed data manipulation, most developer-friendly docs

---

### 3. Reapit/Agentbox (McGrath & Belle Property)

**Who Uses It**: McGrath, Belle Property

**API Documentation**: https://foundations-documentation.reapit.cloud  
**Interactive Explorer**: https://platform.reapit.cloud  
**Base Endpoint**: `https://platform.reapit.cloud/`

**Architecture**: Webhook-first
- Push notifications when agent publishes
- No constant polling needed
- "App Market" integrations

**Authentication**: Developer Portal registration  
**Best For**: Building apps that sit inside the CRM UI

---

## WordPress Real Estate Plugins

### 1. Easy Property Listings (EPL)

**Type**: WordPress-native plugin  
**API**: Extends core WordPress REST API

**Endpoints**:
- `/wp-json/wp/v2/property` - All properties
- `/wp-json/wp/v2/rental` - Rentals only
- `/wp-json/wp/v2/commercial` - Commercial properties
- `/wp-json/wp/v2/property?_embed` - With 150+ Australian-specific fields

**Authentication**: Usually public or WordPress Application Passwords  
**Data Source**: REXML via FeedSync (FTP ingestion)

**Used By**: Cameron Real Estate (Melbourne), many smaller agencies

---

### 2. Agentpoint (PropertyHub API)

**Type**: Professional-grade standalone API

**Endpoints**:
- `/properties?beds=>3&price=<1000000` - Queryable with operators
- `/properties?summary=1` - IDs and updated_at only (fast sync)
- `/agents` - Staff profiles

**Operators**: `~` (contains), `>` (greater), `!` (not equal)  
**Data Source**: REXML via unique FTP endpoint

---

### 3. Property Hive

**Type**: Full CRUD API for listings

**Endpoints**:
- `GET/POST/DELETE /wp-json/wp/v2/property` - Full CRUD
- `/wp-json/wp/v2/office` - Multi-office data
- `/wp-json/wp/v2/enquiry` - Lead ingestion endpoint
- `/wp-json/ph/v1/export/reaxml` - Outbound REXML feed

**Best For**: External mobile apps that need to create/delete listings

---

### 4. Realtyna (WPL API V2)

**Type**: OAuth 1.0 secured, app-ready

**Namespace**: `/wpl_api/v2/`

**Endpoints**:
- `/wpl_api/v2/flex/property-types` - Data structure
- `/wpl_api/v2/listings` - Advanced filtering for IDX
- `/wpl_api/v2/users/register` - Custom user features
- `/wpl_api/v2/notifications` - SMS/alerts API

**Best For**: "Organic IDX" and mobile app development

---

## How to Verify Technology Stack

### Ray White Offices

1. Open Developer Tools (F12) on listing page
2. Filter Network tab by "Fetch/XHR"
3. Look for:
   - `nurturecloud.com` - Agent OS (Smart Data)
   - `onesystem.raywhite.com` - Internal gateway
   - `vaultre.com.au` - Image CDN
   - `/api/proxy/v1/` - Public proxy API

### WordPress Sites

1. View page source
2. Search for:
   - `wp-content/plugins/easy-property-listings`
   - `wp-content/plugins/property-hive`
   - `wp-content/plugins/agentpoint`
   - `wp-content/plugins/wpl-real-estate`

3. Test API endpoints:
   - `/wp-json/wp/v2/property`
   - `/wp-json/wp/v2/commercial`

---

## API Access Summary

| Product | Access Method | Best For |
|---------|--------------|----------|
| VaultRE | Office invitation for API keys | Ray White/LJ Hooker data |
| Rex | Token from Rex user | High-speed manipulation |
| Reapit | Developer Portal signup | App marketplace integrations |
| EPL | Public or WP passwords | Australian field mapping |
| Domain.com.au | Developer Portal signup | All agents' data (portal) |

---

## Implementation Notes

### VaultRE Public Proxy

Many Ray White offices expose listings publicly:
```
GET https://{office}.com.au/api/proxy/v1/listings?pageSize=100&page=1
```

**Response**:
```json
{
  "data": [
    {
      "value": {
        "id": 3437026,
        "propertyId": 33870076,
        "providerCode": "VAULT",
        "title": "Property title",
        "typeCode": "REN|SAL|COM",
        "statusCode": "CUR|SOL|LSE",
        "geo": {
          "latitude": -37.5622,
          "longitude": 143.8503
        }
      }
    }
  ],
  "hits": 94753
}
```

**No authentication required!**

### WordPress EPL REST API

Standard WordPress REST API with EPL extensions:
```
GET /wp-json/wp/v2/commercial?per_page=100&page=1
```

**Response includes**:
- `meta.property_address_coordinates` - Lat/long
- `meta.property_price` - Numeric price
- `meta.property_price_display` - Display text
- `meta.property_building_area` - Area in sqm
- Full REXML-mapped Australian fields

---

## Scout Implementation Guide

### For VaultRE Sites (Ray White/LJ Hooker)

Extend `VaultREScout` base class:
```typescript
class RayWhiteOfficeScout extends VaultREScout {
  readonly name = 'Ray White Office Name';
  protected readonly apiBaseUrl = 'https://raywhite{office}.com.au';
}
```

### For WordPress EPL Sites

Extend `WordPressEPLScout` base class:
```typescript
class AgencyScout extends WordPressEPLScout {
  readonly name = 'Agency Name';
  protected buildSearchUrl(criteria: SearchParams): string {
    return `https://agency.com.au/commercial/?type=industrial`;
  }
}
```

### For Custom Platforms (CBRE, PRD, etc.)

Implement `BaseScout` directly with custom API logic.

---

## Production Considerations

1. **Rate Limiting**: Most APIs have rate limits (typically 100-1000 requests/hour)
2. **Authentication**: Store API keys securely (environment variables)
3. **Caching**: Cache responses for 15-60 minutes to reduce API calls
4. **Pagination**: Handle large result sets properly
5. **Error Handling**: Graceful fallback when APIs are unavailable
6. **Monitoring**: Log API response times and error rates

---

## Resources

- **VaultRE Docs**: https://docs.api.vaultre.com.au
- **Rex Docs**: https://api-docs.rexsoftware.com
- **Reapit Docs**: https://foundations-documentation.reapit.cloud
- **EPL Plugin**: https://easypropertylistings.com.au
- **WordPress REST API**: https://developer.wordpress.org/rest-api/

---

Last Updated: 2026-01-18
