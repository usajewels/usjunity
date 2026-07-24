package com.mxsuite.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Loads the hierarchical v2 target schema at startup and provides
 * flat and hierarchical views for the rest of the application.
 */
@Service
public class TargetSchemaService {

    private static final Logger log = LoggerFactory.getLogger(TargetSchemaService.class);
    private static final String SCHEMA_PATH = "growthzone-target-schema-v2.json";
    private static final Pattern CAMEL_SPLIT = Pattern.compile("(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])");

    /** Flat field list: [{entity, name, type, required, description}, ...] */
    private List<Map<String, Object>> flatFields;

    /** Raw parsed v2 JSON for the /schema/v2 endpoint */
    private Map<String, Object> hierarchicalSchema;

    /** Mapping-engine field defs with aliases */
    private List<TargetFieldDef> targetFieldDefs;

    /** Hand-curated aliases for common fields (preserves original 16-field aliases) */
    private static final Map<String, Set<String>> CURATED_ALIASES = Map.ofEntries(
            Map.entry("Contact.firstName", Set.of("firstname", "first", "fname", "givenname")),
            Map.entry("Contact.lastName", Set.of("lastname", "last", "lname", "surname", "familyname")),
            Map.entry("Contact.email", Set.of("email", "emailaddress", "mail", "contactemail", "primaryemail")),
            Map.entry("Contact.email2", Set.of("email2", "secondaryemail", "alternativeemail", "altemail")),
            Map.entry("Contact.phone", Set.of("phone", "phonenumber", "telephone", "tel", "primaryphone",
                    "mobile", "cellphone", "cell", "workphone")),
            Map.entry("Contact.homePhone", Set.of("homephone", "homephonenumber", "personalphone")),
            Map.entry("Contact.mobilePhone", Set.of("mobilephone", "cellphone", "cell", "mobile", "cellphonenumber")),
            Map.entry("Contact.fax", Set.of("fax", "faxnumber")),
            Map.entry("Contact.company", Set.of("company", "companyname", "organization", "organisation",
                    "org", "employer", "business", "firm")),
            Map.entry("Contact.title", Set.of("title", "jobtitle", "position", "role", "designation")),
            Map.entry("Contact.dateOfBirth", Set.of("dateofbirth", "dob", "birthday", "birthdate")),
            Map.entry("Contact.website", Set.of("website", "url", "webpage", "homepage")),
            Map.entry("Contact.sourceId", Set.of("sourceid", "contactid", "id", "memberid", "recordid")),
            Map.entry("Contact.contactType", Set.of("contacttype", "type", "category")),
            Map.entry("Contact.status", Set.of("status", "contactstatus", "memberstatus")),
            Map.entry("Contact.tags", Set.of("tags", "keywords", "labels")),
            Map.entry("Contact.notes", Set.of("notes", "comments", "description", "memo", "remarks", "note", "comment")),
            Map.entry("ContactAddress.address1", Set.of("address1", "address", "streetaddress", "street",
                    "addressline1", "mailingaddress", "primaryaddress")),
            Map.entry("ContactAddress.address2", Set.of("address2", "addressline2", "suite", "apt", "unit")),
            Map.entry("ContactAddress.city", Set.of("city", "town", "locality")),
            Map.entry("ContactAddress.state", Set.of("state", "province", "region", "stateprovince")),
            Map.entry("ContactAddress.zip", Set.of("zip", "zipcode", "postalcode", "postal", "postcode")),
            Map.entry("ContactAddress.country", Set.of("country", "countrycode", "nation")),
            Map.entry("Organization.orgName", Set.of("orgname", "organizationname", "companyname", "company",
                    "businessname")),
            Map.entry("Organization.orgEmail", Set.of("orgemail", "companyemail", "organizationemail")),
            Map.entry("Organization.orgPhone", Set.of("orgphone", "companyphone", "officephone", "mainphone")),
            Map.entry("Organization.orgWebsite", Set.of("orgwebsite", "companywebsite", "companyurl")),
            Map.entry("Membership.memberType", Set.of("membertype", "membershiptype", "membership", "type",
                    "category", "memberlevel", "membershiplevel", "level")),
            Map.entry("Membership.memberStatus", Set.of("memberstatus", "membershipstatus", "status")),
            Map.entry("Membership.joinDate", Set.of("joindate", "startdate", "datejoined", "membershipstart",
                    "membersince", "enrollmentdate", "activationdate", "signupdate")),
            Map.entry("Membership.expirationDate", Set.of("expirationdate", "expdate", "expiration", "enddate",
                    "renewaldate", "membershipend", "expiry", "expirydate")),
            Map.entry("Membership.duesAmount", Set.of("duesamount", "dues", "amount", "fee", "membershipfee")),
            Map.entry("Membership.memberNotes", Set.of("membernotes", "membershipnotes", "notes", "comments")),
            Map.entry("Event.eventName", Set.of("eventname", "eventtitle", "title", "name")),
            Map.entry("Event.startDate", Set.of("startdate", "eventstart", "eventdate", "begindate")),
            Map.entry("Event.endDate", Set.of("enddate", "eventend", "finishdate")),
            Map.entry("Event.eventType", Set.of("eventtype", "type", "category")),
            Map.entry("Invoice.invoiceNumber", Set.of("invoicenumber", "invoiceno", "invoicenum", "invnum")),
            Map.entry("Invoice.invoiceDate", Set.of("invoicedate", "invdate", "billdate")),
            Map.entry("Invoice.invoiceTotal", Set.of("invoicetotal", "total", "amount", "invoiceamount")),
            Map.entry("Payment.paymentAmount", Set.of("paymentamount", "amount", "amountpaid", "paid")),
            Map.entry("Payment.paymentDate", Set.of("paymentdate", "datepaid", "paiddate")),
            Map.entry("Payment.paymentMethod", Set.of("paymentmethod", "method", "paytype", "paymenttype")),
            Map.entry("Order.orderNumber", Set.of("ordernumber", "orderno", "ordernum")),
            Map.entry("Order.orderDate", Set.of("orderdate", "dateordered"))
    );

    public record TargetFieldDef(String entity, String field, String description, Set<String> aliases) {}

    private final ObjectMapper objectMapper;

    public TargetSchemaService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    public void init() {
        try (InputStream is = new ClassPathResource(SCHEMA_PATH).getInputStream()) {
            hierarchicalSchema = objectMapper.readValue(is, new TypeReference<>() {});
            flatFields = flatten(hierarchicalSchema);
            targetFieldDefs = buildTargetFieldDefs(flatFields);
            log.info("Loaded target schema v2: {} fields across {} entities",
                    flatFields.size(), countEntities(hierarchicalSchema));
        } catch (IOException e) {
            log.error("Failed to load {}: {}", SCHEMA_PATH, e.getMessage());
            // Fall back to empty — AdminOnboardingController will still work with stored schemas
            flatFields = List.of();
            hierarchicalSchema = Map.of();
            targetFieldDefs = List.of();
        }
    }

    /** Flat field list for backward-compatible endpoints and Onboarding JSONB default */
    public List<Map<String, Object>> getFlatFields() {
        return flatFields;
    }

    /** Raw v2 hierarchical JSON for entity-aware UIs */
    public Map<String, Object> getHierarchicalSchema() {
        return hierarchicalSchema;
    }

    /** Field defs with aliases for the mapping engine (AI + rule-based) */
    public List<TargetFieldDef> getTargetFieldDefs() {
        return targetFieldDefs;
    }

    // --- Flattening logic ---

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> flatten(Map<String, Object> schema) {
        var result = new ArrayList<Map<String, Object>>();
        var entities = (Map<String, Object>) schema.get("entities");
        if (entities == null) return result;

        for (var entry : entities.entrySet()) {
            String entityName = entry.getKey();
            var entityDef = (Map<String, Object>) entry.getValue();
            flattenEntity(entityName, entityDef, result);
        }
        return Collections.unmodifiableList(result);
    }

    @SuppressWarnings("unchecked")
    private void flattenEntity(String entityName, Map<String, Object> entityDef,
                               List<Map<String, Object>> result) {
        // Add reference fields (FK links like contactSourceId, memberContactSourceId)
        var references = (Map<String, Object>) entityDef.get("references");
        if (references != null) {
            for (var ref : references.entrySet()) {
                var refDef = (Map<String, Object>) ref.getValue();
                var field = new LinkedHashMap<String, Object>();
                field.put("entity", entityName);
                field.put("name", ref.getKey());
                field.put("type", "string");
                field.put("required", Boolean.TRUE.equals(refDef.get("required")));
                field.put("description", refDef.getOrDefault("description", "Reference to " + refDef.get("entity")));
                result.add(field);
            }
        }

        // Add regular fields
        var fields = (Map<String, Object>) entityDef.get("fields");
        if (fields != null) {
            for (var f : fields.entrySet()) {
                var fieldDef = (Map<String, Object>) f.getValue();
                var field = new LinkedHashMap<String, Object>();
                field.put("entity", entityName);
                field.put("name", f.getKey());
                field.put("type", fieldDef.getOrDefault("type", "string"));
                field.put("required", Boolean.TRUE.equals(fieldDef.get("required")));
                field.put("description", fieldDef.getOrDefault("description", ""));
                result.add(field);
            }
        }

        // Add child entity fields (parentKey becomes a reference field in the child)
        var children = (Map<String, Object>) entityDef.get("children");
        if (children != null) {
            for (var child : children.entrySet()) {
                String childName = child.getKey();
                var childDef = (Map<String, Object>) child.getValue();

                // Add the parentKey as a reference field
                String parentKey = (String) childDef.get("parentKey");
                if (parentKey != null) {
                    var pkField = new LinkedHashMap<String, Object>();
                    pkField.put("entity", childName);
                    pkField.put("name", parentKey);
                    pkField.put("type", "string");
                    pkField.put("required", true);
                    pkField.put("description", "Source ID of the parent " + entityName.toLowerCase());
                    result.add(pkField);
                }

                // Recurse into child entity (references + fields)
                flattenEntity(childName, childDef, result);
            }
        }
    }

    // --- Alias generation ---

    private List<TargetFieldDef> buildTargetFieldDefs(List<Map<String, Object>> flat) {
        var defs = new ArrayList<TargetFieldDef>();
        for (var field : flat) {
            String entity = (String) field.get("entity");
            String name = (String) field.get("name");
            String description = (String) field.getOrDefault("description", "");
            String key = entity + "." + name;

            Set<String> aliases = CURATED_ALIASES.getOrDefault(key, generateAliases(name));
            defs.add(new TargetFieldDef(entity, name, description, aliases));
        }
        return Collections.unmodifiableList(defs);
    }

    /** Auto-generate aliases from a camelCase field name */
    static Set<String> generateAliases(String fieldName) {
        Set<String> aliases = new LinkedHashSet<>();
        String lower = fieldName.toLowerCase();
        aliases.add(lower);

        // Split camelCase: "firstName" -> ["first", "name"]
        String[] parts = CAMEL_SPLIT.split(fieldName);
        if (parts.length > 1) {
            // joined without separator: "firstname"
            aliases.add(String.join("", parts).toLowerCase());
            // joined with underscore: "first_name"
            aliases.add(String.join("_", parts).toLowerCase());
            // first word only if it's descriptive enough (>= 3 chars)
            if (parts[0].length() >= 3) {
                aliases.add(parts[0].toLowerCase());
            }
        }

        // Remove common prefixes for entity-specific fields
        for (String prefix : List.of("org", "event", "invoice", "payment", "order",
                "member", "reg", "ili", "oli")) {
            if (lower.startsWith(prefix) && lower.length() > prefix.length()) {
                String stripped = lower.substring(prefix.length());
                if (stripped.length() >= 3) {
                    aliases.add(stripped);
                }
            }
        }

        return Collections.unmodifiableSet(aliases);
    }

    @SuppressWarnings("unchecked")
    private int countEntities(Map<String, Object> schema) {
        var entities = (Map<String, Object>) schema.get("entities");
        if (entities == null) return 0;
        int count = 0;
        for (var entry : entities.values()) {
            count++;
            var entityDef = (Map<String, Object>) entry;
            var children = (Map<String, Object>) entityDef.get("children");
            if (children != null) count += children.size();
        }
        return count;
    }
}
