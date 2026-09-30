package com.emailsystem.service;

import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class TemplateService {

    private static final Pattern VAR_PATTERN = Pattern.compile("\\$\\{(\\w+)}");

    public static final Map<String, String> BUILT_IN_VARS = new LinkedHashMap<>();

    static {
        BUILT_IN_VARS.put("cust_name", "John Smith");
        BUILT_IN_VARS.put("cust_email", "john@example.com");
        BUILT_IN_VARS.put("cust_company", "ABC Trading Co.");
        BUILT_IN_VARS.put("cust_phone", "+1-234-567-8900");
        BUILT_IN_VARS.put("cust_country", "USA");
        BUILT_IN_VARS.put("cust_tags", "VIP,Regular");
        BUILT_IN_VARS.put("cust_notes", "Sample notes");
    }

    public static Set<String> getBuiltInVarNames() {
        return BUILT_IN_VARS.keySet();
    }

    public List<String> extractVariables(String text) {
        if (text == null || text.isEmpty()) return List.of();
        Matcher matcher = VAR_PATTERN.matcher(text);
        Set<String> vars = new LinkedHashSet<>();
        while (matcher.find()) {
            String varName = matcher.group(1);
            if (!BUILT_IN_VARS.containsKey(varName)) {
                vars.add(varName);
            }
        }
        return new ArrayList<>(vars);
    }

    public Map<String, String> previewTemplate(String subject, String body, Map<String, String> customVars) {
        String combined = subject + " " + body;
        Set<String> allVars = new LinkedHashSet<>();
        Matcher matcher = VAR_PATTERN.matcher(combined);
        while (matcher.find()) {
            allVars.add(matcher.group(1));
        }

        Map<String, String> sampleData = new LinkedHashMap<>(BUILT_IN_VARS);

        if (customVars != null) {
            sampleData.putAll(customVars);
        }

        for (String varName : allVars) {
            sampleData.putIfAbsent(varName, "[" + varName + "]");
        }

        String previewSubject = replaceVars(subject, sampleData);
        String previewBody = replaceVars(body, sampleData);

        Map<String, String> result = new LinkedHashMap<>();
        result.put("subject", previewSubject);
        result.put("body", previewBody);
        return result;
    }

    public String replaceVars(String text, Map<String, String> vars) {
        if (text == null) return "";
        Matcher matcher = VAR_PATTERN.matcher(text);
        StringBuilder sb = new StringBuilder();
        while (matcher.find()) {
            String varName = matcher.group(1);
            String replacement = vars.getOrDefault(varName, "");
            matcher.appendReplacement(sb, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(sb);
        return sb.toString();
    }
}
